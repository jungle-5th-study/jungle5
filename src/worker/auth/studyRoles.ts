// Study membership = Discord role (PRD D-23, TSD TD-23).
// study_members is a cache recomputed from the member's guild role IDs whenever
// Discord confirms the member: login, the 24h re-verification and
// POST /api/me/refresh-roles. Those checks also store the role IDs on the member
// (members.discord_role_ids) so that creating a study or changing its role can
// recompute that study's members immediately (TSD 3.2). The site never edits
// study_members otherwise.
import { and, eq, notInArray, sql } from "drizzle-orm";
import { members, studies, studyMembers } from "../db/schema";
import type { Db } from "../types";

/**
 * Two write statements (no reads) to run inside the caller's `db.batch()`:
 * remove memberships whose study role the member no longer has, then add the
 * missing ones. Rows that persist keep their `joined_at`.
 * Role IDs are passed as one JSON parameter (`json_each`) so a member with many
 * roles never hits D1's bound-parameter limit.
 */
export function studyMembershipStatements(db: Db, memberId: string, roleIds: readonly string[], now: number) {
  const roleJson = JSON.stringify(roleIds);
  const matchingStudies = db
    .select({ id: studies.id })
    .from(studies)
    .where(sql`${studies.discordRoleId} IN (SELECT value FROM json_each(${roleJson}))`);
  return [
    db
      .delete(studyMembers)
      .where(and(eq(studyMembers.memberId, memberId), notInArray(studyMembers.studyId, matchingStudies))),
    db
      .insert(studyMembers)
      .select(
        db
          .select({
            studyId: studies.id,
            memberId: sql<string>`${memberId}`.as("member_id"),
            joinedAt: sql<number>`${now}`.as("joined_at"),
          })
          .from(studies)
          .where(sql`${studies.discordRoleId} IN (SELECT value FROM json_each(${roleJson}))`),
      )
      .onConflictDoNothing(),
  ] as const;
}

/**
 * Two write statements recomputing one study's members from the role IDs stored
 * at each member's last Discord check: every non-withdrawn guild member whose
 * stored roles include `roleId` is a member, nobody else is. For a study
 * created or re-linked in the same batch (run these after that write).
 * Members never checked since migration 0002 (NULL role IDs) are not members
 * until their next check.
 */
export function studyRecomputeStatements(db: Db, studyId: string, roleId: string, now: number) {
  const holders = db
    .select({ id: members.id })
    .from(members)
    .where(
      and(
        sql`${members.withdrawnAt} IS NULL`,
        eq(members.isGuildMember, true),
        sql`${roleId} IN (SELECT value FROM json_each(COALESCE(${members.discordRoleIds}, '[]')))`,
      ),
    );
  return [
    db.delete(studyMembers).where(and(eq(studyMembers.studyId, studyId), notInArray(studyMembers.memberId, holders))),
    db
      .insert(studyMembers)
      .select(
        db
          .select({
            studyId: sql<string>`${studyId}`.as("study_id"),
            memberId: members.id,
            joinedAt: sql<number>`${now}`.as("joined_at"),
          })
          .from(members)
          .where(
            and(
              sql`${members.withdrawnAt} IS NULL`,
              eq(members.isGuildMember, true),
              sql`${roleId} IN (SELECT value FROM json_each(COALESCE(${members.discordRoleIds}, '[]')))`,
            ),
          ),
      )
      .onConflictDoNothing(),
  ] as const;
}
