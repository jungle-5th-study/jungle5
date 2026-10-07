// Read-side loaders and row → API mappers for studies and rounds (M2).
// Joined reads run with Promise.all, never db.batch (TSD 3.2).
import { and, asc, desc, eq, inArray, isNull, lt, sql, type SQL } from "drizzle-orm";
import type {
  MemberSummary,
  Round,
  RoundDetail,
  RoundRef,
  Status,
  StudyDetail,
  StudyListItem,
} from "../../shared/api";
import { LIMITS } from "../../shared/constants";
import { comments, members, posts, rounds, studies, studyMembers, type RoundRow, type StudyRow } from "../db/schema";
import { notFound } from "../lib/errors";
import {
  canCommentOnRound,
  canCreateRound,
  canDeleteRound,
  canEditRound,
  canEditStudy,
  canEndStudy,
  canLinkPostToRound,
  canSetRoundStatus,
  canViewStudy,
  canWriteNotes,
  type Actor,
  type StudyFacts,
} from "../policies";
import type { Db } from "../types";
import { commentSelect, commentVisibility, listPosts, memberSummary, toComment } from "./views";

/** Policy facts for one viewer: membership is all a policy needs to know about the member list. */
export const studyFacts = (actor: Actor, status: Status, isMember: boolean): StudyFacts => ({
  status,
  memberIds: isMember ? [actor.id] : [],
});

/** Non-admins never see hidden studies (canViewStudy); as a SQL filter on `studies`. */
export function studyVisibility(actor: Actor): SQL | undefined {
  return actor.isAdmin ? undefined : isNull(studies.hiddenAt);
}

/** EXISTS(actor is a member of the study whose id is `studyIdSql`). */
const isMemberSql = (studyIdSql: SQL, actorId: string) =>
  sql<number>`EXISTS (SELECT 1 FROM study_members sm WHERE sm.study_id = ${studyIdSql} AND sm.member_id = ${actorId})`;

/** Members counted/listed: role holders who are still in the guild (withdrawn rows are already removed). */
const activeMemberCount = sql<number>`(SELECT count(*) FROM study_members sm JOIN members m ON m.id = sm.member_id WHERE sm.study_id = "studies"."id" AND m.is_guild_member = 1)`;

// ---------------------------------------------------------------- studies

export interface LoadedStudy {
  study: StudyRow;
  isMember: boolean;
  facts: StudyFacts;
}

/** The study (404 when missing or hidden from the viewer) + the viewer's membership. 1 query. */
export async function loadStudy(db: Db, actor: Actor, id: string): Promise<LoadedStudy> {
  const row = await db
    .select({ study: studies, isMember: isMemberSql(sql`"studies"."id"`, actor.id) })
    .from(studies)
    .where(eq(studies.id, id))
    .get();
  if (!row || !canViewStudy(actor, row.study)) throw notFound();
  const isMember = Boolean(row.isMember);
  return { study: row.study, isMember, facts: studyFacts(actor, row.study.status, isMember) };
}

const toRoundRef = (r: Pick<RoundRow, "id" | "seq" | "title" | "meetingAt" | "status">): RoundRef => ({
  id: r.id,
  seq: r.seq,
  title: r.title,
  meetingAt: r.meetingAt,
  status: r.status,
});

/** GET /api/studies/:id. 3 queries (concurrent) after `loaded`. */
export async function loadStudyDetail(db: Db, actor: Actor, id: string, loaded?: LoadedStudy): Promise<StudyDetail> {
  const [{ study, isMember, facts }, memberRows, roundRows] = await Promise.all([
    loaded ? Promise.resolve(loaded) : loadStudy(db, actor, id),
    db
      .select({
        id: members.id,
        displayName: members.displayName,
        avatarUrl: members.avatarUrl,
        withdrawnAt: members.withdrawnAt,
      })
      .from(studyMembers)
      .innerJoin(members, eq(members.id, studyMembers.memberId))
      .where(and(eq(studyMembers.studyId, id), eq(members.isGuildMember, true)))
      .orderBy(asc(studyMembers.joinedAt), asc(members.id)),
    db
      .select({ id: rounds.id, seq: rounds.seq, title: rounds.title, meetingAt: rounds.meetingAt, status: rounds.status })
      .from(rounds)
      .where(eq(rounds.studyId, id))
      .orderBy(asc(rounds.seq)),
  ]);
  return {
    id: study.id,
    name: study.name,
    goal: study.goal,
    description: study.description,
    materials: study.materials,
    cadence: study.cadence,
    joinGuide: study.joinGuide,
    discordRoleId: study.discordRoleId,
    status: study.status,
    hidden: study.hiddenAt !== null,
    version: study.version,
    createdAt: study.createdAt,
    updatedAt: study.updatedAt,
    isMember,
    members: memberRows.map(memberSummary),
    rounds: roundRows.map(toRoundRef),
    permissions: {
      canEdit: canEditStudy(actor, facts),
      canCreateRound: canCreateRound(actor, facts),
      canManage: canEndStudy(actor),
    },
  };
}

/** GET /api/studies. 2 queries (concurrent). */
export async function listStudies(db: Db, actor: Actor, status: Status | undefined, now: number): Promise<StudyListItem[]> {
  const where = and(studyVisibility(actor), status ? eq(studies.status, status) : undefined);
  const [studyRows, roundRows] = await Promise.all([
    db
      .select({
        id: studies.id,
        name: studies.name,
        goal: studies.goal,
        cadence: studies.cadence,
        status: studies.status,
        hiddenAt: studies.hiddenAt,
        isMember: isMemberSql(sql`"studies"."id"`, actor.id),
        memberCount: activeMemberCount,
      })
      .from(studies)
      .where(where),
    db
      .select({
        id: rounds.id,
        studyId: rounds.studyId,
        seq: rounds.seq,
        title: rounds.title,
        meetingAt: rounds.meetingAt,
        status: rounds.status,
      })
      .from(rounds)
      .innerJoin(studies, eq(studies.id, rounds.studyId))
      .where(where)
      .orderBy(asc(rounds.studyId), asc(rounds.seq)),
  ]);

  const latest = new Map<string, RoundRef>();
  const next = new Map<string, RoundRef>();
  for (const r of roundRows) {
    latest.set(r.studyId, toRoundRef(r)); // seq ascending: the last one wins
    if (r.meetingAt !== null && r.meetingAt >= now) {
      const cur = next.get(r.studyId);
      if (!cur || (cur.meetingAt ?? Infinity) > r.meetingAt) next.set(r.studyId, toRoundRef(r));
    }
  }
  const group = (s: { isMember: boolean; status: Status }) => (s.status === "ended" ? 2 : s.isMember ? 0 : 1);
  return studyRows
    .map(
      (s): StudyListItem => ({
        id: s.id,
        name: s.name,
        goal: s.goal,
        cadence: s.cadence,
        status: s.status,
        hidden: s.hiddenAt !== null,
        isMember: Boolean(s.isMember),
        memberCount: Number(s.memberCount),
        latestRound: latest.get(s.id) ?? null,
        nextMeeting: next.get(s.id) ?? null,
      }),
    )
    .sort(
      (a, b) =>
        group(a) - group(b) ||
        Number(b.isMember) - Number(a.isMember) ||
        a.name.localeCompare(b.name, "ko") ||
        a.id.localeCompare(b.id),
    );
}

// ---------------------------------------------------------------- rounds

export interface LoadedRound {
  round: RoundRow;
  study: { id: string; name: string; status: Status; hiddenAt: number | null };
  isMember: boolean;
  facts: StudyFacts;
  /** No linked posts (hidden ones included), no comments (hidden included), no notes. */
  empty: boolean;
}

/** The round + its study + the viewer's membership + emptiness. 404 when hidden from the viewer. 1 query. */
export async function loadRoundFacts(db: Db, actor: Actor, id: string): Promise<LoadedRound> {
  const row = await db
    .select({
      round: rounds,
      studyName: studies.name,
      studyStatus: studies.status,
      studyHiddenAt: studies.hiddenAt,
      isMember: isMemberSql(sql`"rounds"."study_id"`, actor.id),
      postCount: sql<number>`(SELECT count(*) FROM posts p WHERE p.round_id = "rounds"."id")`,
      commentCount: sql<number>`(SELECT count(*) FROM comments c WHERE c.round_id = "rounds"."id")`,
    })
    .from(rounds)
    .innerJoin(studies, eq(studies.id, rounds.studyId))
    .where(eq(rounds.id, id))
    .get();
  if (!row || !canViewStudy(actor, { hiddenAt: row.studyHiddenAt })) throw notFound();
  const r = row.round;
  const isMember = Boolean(row.isMember);
  const notesEmpty = [r.notesDiscussion, r.notesOpenQuestions, r.notesNextActions].every((n) => !n?.trim());
  return {
    round: r,
    study: { id: r.studyId, name: row.studyName, status: row.studyStatus, hiddenAt: row.studyHiddenAt },
    isMember,
    facts: studyFacts(actor, row.studyStatus, isMember),
    empty: Number(row.postCount) === 0 && Number(row.commentCount) === 0 && notesEmpty,
  };
}

/** Member summaries for the given IDs. 1 query (0 when empty). */
async function loadMemberSummaries(db: Db, ids: (string | null)[]): Promise<Map<string, MemberSummary>> {
  const unique = [...new Set(ids.filter((i): i is string => i !== null))];
  const map = new Map<string, MemberSummary>();
  if (unique.length === 0) return map;
  const rows = await db
    .select({ id: members.id, displayName: members.displayName, avatarUrl: members.avatarUrl, withdrawnAt: members.withdrawnAt })
    .from(members)
    .where(inArray(members.id, unique));
  for (const m of rows) map.set(m.id, memberSummary(m));
  return map;
}

const unknownMember = (id: string): MemberSummary => ({ id, displayName: null, avatarUrl: null, withdrawn: true });

function toRound(r: RoundRow, people: Map<string, MemberSummary>): Round {
  const who = (id: string | null) => (id === null ? null : (people.get(id) ?? unknownMember(id)));
  return {
    id: r.id,
    studyId: r.studyId,
    seq: r.seq,
    title: r.title,
    scope: r.scope,
    goal: r.goal,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    meetingAt: r.meetingAt,
    location: r.location,
    materials: r.materials,
    status: r.status,
    infoVersion: r.infoVersion,
    infoUpdatedBy: who(r.infoUpdatedBy),
    infoUpdatedAt: r.infoUpdatedAt,
    notesDiscussion: r.notesDiscussion,
    notesOpenQuestions: r.notesOpenQuestions,
    notesNextActions: r.notesNextActions,
    notesVersion: r.notesVersion,
    notesUpdatedBy: who(r.notesUpdatedBy),
    notesUpdatedAt: r.notesUpdatedAt,
    createdBy: who(r.createdBy) ?? unknownMember(r.createdBy),
    createdAt: r.createdAt,
  };
}

/** A round row → API Round (1 query for the people). */
export async function roundFromRow(db: Db, r: RoundRow): Promise<Round> {
  return toRound(r, await loadMemberSummaries(db, [r.createdBy, r.infoUpdatedBy, r.notesUpdatedBy]));
}

/** Round by id without a visibility check (callers already checked). 2 queries. */
export async function loadRoundById(db: Db, id: string): Promise<Round> {
  const r = await db.select().from(rounds).where(eq(rounds.id, id)).get();
  if (!r) throw notFound();
  return roundFromRow(db, r);
}

/** GET /api/rounds/:id. 1 + 5 queries (the 5 concurrent). */
export async function loadRoundDetail(db: Db, actor: Actor, id: string): Promise<RoundDetail> {
  const loaded = await loadRoundFacts(db, actor, id);
  const { round: r, study, isMember, facts, empty } = loaded;
  const [people, linked, commentRows, previousRows] = await Promise.all([
    loadMemberSummaries(db, [r.createdBy, r.infoUpdatedBy, r.notesUpdatedBy]),
    listPosts(db, actor, [eq(posts.roundId, id)], LIMITS.roundPostsMax),
    commentSelect(db)
      .where(and(eq(comments.roundId, id), commentVisibility(actor)))
      .orderBy(asc(comments.createdAt), asc(comments.id)),
    db
      .select({
        id: rounds.id,
        seq: rounds.seq,
        title: rounds.title,
        notesOpenQuestions: rounds.notesOpenQuestions,
        notesNextActions: rounds.notesNextActions,
      })
      .from(rounds)
      .where(and(eq(rounds.studyId, r.studyId), lt(rounds.seq, r.seq)))
      .orderBy(desc(rounds.seq))
      .limit(1),
  ]);
  const roundFacts = { status: r.status };
  return {
    ...toRound(r, people),
    study: { id: study.id, name: study.name, status: study.status, hidden: study.hiddenAt !== null },
    isMember,
    posts: linked.items,
    comments: commentRows.map(toComment),
    previous: previousRows[0] ?? null,
    permissions: {
      canEditInfo: canEditRound(actor, facts, roundFacts),
      canWriteNotes: canWriteNotes(actor, facts, roundFacts),
      canSetStatus: canSetRoundStatus(actor, facts),
      canDelete: canDeleteRound(actor, facts) && empty,
      canLink: canLinkPostToRound(actor, { authorId: actor.id }, facts, roundFacts),
      canComment: canCommentOnRound(actor),
    },
  };
}
