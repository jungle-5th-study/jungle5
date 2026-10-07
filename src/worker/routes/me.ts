// /api/me (TSD 7.1), role refresh (TD-23) and withdrawal (TSD 5.2, 8.3; PRD F-11).
import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Home, LinkableRound, Me, NextMeeting } from "../../shared/api";
import { LIMITS, REFRESH_ROLES_INTERVAL_SECONDS } from "../../shared/constants";
import { kstWeekRange } from "../../shared/time";
import { authSessions, discordTokens, members, opsState, rounds, studies, studyMembers } from "../db/schema";
import { reverify } from "../auth/middleware";
import { clearSessionCookie } from "../auth/session";
import { discordUnavailable, forbidden, notFound, rateLimited } from "../lib/errors";
import { canWithdraw, type Actor } from "../policies";
import type { AppEnv, Db } from "../types";
import { studyVisibility } from "./studyViews";
import { listPosts } from "./views";

const refreshRolesKey = (memberId: string) => `refresh_roles:${memberId}`;

/** GET /api/me payload. 2 queries, issued concurrently (joins: not db.batch, TSD 3.2). */
async function loadMe(db: Db, actor: Actor): Promise<Me> {
  const [rows, myStudies] = await Promise.all([
    db
      .select({ id: members.id, displayName: members.displayName, avatarUrl: members.avatarUrl })
      .from(members)
      .where(eq(members.id, actor.id)),
    db
      .select({ id: studies.id, name: studies.name, status: studies.status })
      .from(studyMembers)
      .innerJoin(studies, eq(studies.id, studyMembers.studyId))
      .where(and(eq(studyMembers.memberId, actor.id), studyVisibility(actor)))
      .orderBy(desc(studyMembers.joinedAt), studies.name),
  ]);
  const me = rows[0];
  if (!me) throw notFound();
  return {
    id: me.id,
    displayName: me.displayName,
    avatarUrl: me.avatarUrl,
    isAdmin: actor.isAdmin,
    studies: myStudies,
  };
}

/** Rounds of the actor's active (visible) studies; base for home and linkable rounds. */
function myActiveStudyRounds(db: Db, actor: Actor) {
  return and(
    eq(studies.status, "active"),
    studyVisibility(actor),
    sql`EXISTS (SELECT 1 FROM study_members sm WHERE sm.study_id = ${rounds.studyId} AND sm.member_id = ${actor.id})`,
  );
}

/** Home "this week": my active studies' rounds meeting in the current KST week, ascending. 1 query. */
async function loadNextMeetings(db: Db, actor: Actor, now: number): Promise<NextMeeting[]> {
  const { start, end } = kstWeekRange(now);
  const rows = await db
    .select({
      roundId: rounds.id,
      studyId: studies.id,
      studyName: studies.name,
      seq: rounds.seq,
      title: rounds.title,
      scope: sql<string>`substr(${rounds.scope}, 1, ${LIMITS.scopeExcerpt})`,
      location: rounds.location,
      meetingAt: rounds.meetingAt,
      roundStatus: rounds.status,
      // Same for every viewer, like category counts: hidden posts never count.
      linkedPostCount: sql<number>`(SELECT count(*) FROM posts p WHERE p.round_id = ${rounds.id} AND p.hidden_at IS NULL)`,
    })
    .from(rounds)
    .innerJoin(studies, eq(studies.id, rounds.studyId))
    .where(and(myActiveStudyRounds(db, actor), gte(rounds.meetingAt, start), lt(rounds.meetingAt, end)))
    .orderBy(asc(rounds.meetingAt), asc(studies.name), asc(rounds.seq));
  return rows.map((r) => ({ ...r, meetingAt: r.meetingAt ?? start, linkedPostCount: Number(r.linkedPostCount) }));
}

/**
 * Claims the member's refresh slot (at most once per REFRESH_ROLES_INTERVAL_SECONDS).
 * Atomic: the upsert only overwrites a slot that has expired. Returns the
 * seconds to wait, or 0 when claimed. 1 query (+1 when limited).
 */
async function claimRefreshSlot(db: Db, memberId: string, now: number): Promise<number> {
  const intervalMs = REFRESH_ROLES_INTERVAL_SECONDS * 1000;
  const key = refreshRolesKey(memberId);
  const claimed = await db
    .insert(opsState)
    .values({ key, value: String(now), updatedAt: now })
    .onConflictDoUpdate({
      target: opsState.key,
      set: { value: String(now), updatedAt: now },
      setWhere: sql`${opsState.updatedAt} <= ${now - intervalMs}`,
    })
    .returning({ updatedAt: opsState.updatedAt });
  if (claimed.length > 0) return 0;
  const row = await db.select({ updatedAt: opsState.updatedAt }).from(opsState).where(eq(opsState.key, key)).get();
  const waitMs = (row?.updatedAt ?? now) + intervalMs - now;
  return Math.max(1, Math.ceil(waitMs / 1000));
}

export const meRoutes = new Hono<AppEnv>()
  .get("/me", async (c) => c.json(await loadMe(c.get("db"), c.get("actor"))))

  // TD-23: re-check Discord now (e.g. right after getting a study role).
  // Same path as the 24h re-verification, but without the outage grace window.
  .post("/me/refresh-roles", async (c) => {
    let actor = c.get("actor");
    const db = c.get("db");
    const now = c.get("deps").now();
    const retryAfter = await claimRefreshSlot(db, actor.id, now);
    if (retryAfter > 0) throw rateLimited(retryAfter, `역할은 ${REFRESH_ROLES_INTERVAL_SECONDS}초에 한 번 새로고침할 수 있습니다`);

    // requireSession may have just re-verified (24h check); do not ask Discord twice.
    if (!c.get("reverified")) {
      const outcome = await reverify(db, c.env, c.get("deps").discord(c.env), c.get("reverifyInput"), "fail");
      switch (outcome.kind) {
        case "rejected":
          clearSessionCookie(c);
          throw outcome.error;
        case "unavailable":
        case "grace":
          throw discordUnavailable();
        case "refreshed":
          actor = { ...actor, isAdmin: outcome.isAdmin };
      }
    }
    return c.json(await loadMe(db, actor));
  })

  .delete("/me", async (c) => {
    const actor = c.get("actor");
    if (!canWithdraw(actor)) throw forbidden();
    const db = c.get("db");
    const now = c.get("deps").now();
    // 5.2: one batch — anonymize, drop tokens/sessions, leave studies. Content stays.
    // No study blocks withdrawal: there are no study managers (D-24).
    await db.batch([
      db
        .update(members)
        .set({
          discordUserId: null,
          displayName: null,
          avatarUrl: null,
          isAdmin: false,
          discordRoleIds: null,
          withdrawnAt: now,
        })
        .where(eq(members.id, actor.id)),
      db.delete(discordTokens).where(eq(discordTokens.memberId, actor.id)),
      db.delete(authSessions).where(eq(authSessions.memberId, actor.id)),
      db.delete(studyMembers).where(eq(studyMembers.memberId, actor.id)),
      db.delete(opsState).where(eq(opsState.key, refreshRolesKey(actor.id))),
    ]);
    clearSessionCookie(c);
    return c.body(null, 204);
  })

  // F-08 editor helper: rounds I may link my posts to (active rounds of my
  // active studies), newest first. 1 query.
  .get("/me/linkable-rounds", async (c) => {
    const actor = c.get("actor");
    const db = c.get("db");
    const items: LinkableRound[] = await db
      .select({
        id: rounds.id,
        seq: rounds.seq,
        title: rounds.title,
        studyId: studies.id,
        studyName: studies.name,
      })
      .from(rounds)
      .innerJoin(studies, eq(studies.id, rounds.studyId))
      .where(and(myActiveStudyRounds(db, actor), eq(rounds.status, "active")))
      .orderBy(desc(rounds.createdAt), asc(studies.name), desc(rounds.seq));
    return c.json({ items });
  })

  .get("/home", async (c) => {
    const db = c.get("db");
    const actor = c.get("actor");
    const [nextMeetings, recent] = await Promise.all([
      loadNextMeetings(db, actor, c.get("deps").now()),
      listPosts(db, actor, [], 10),
    ]);
    const body: Home = { nextMeetings, recentPosts: recent.items };
    return c.json(body);
  });
