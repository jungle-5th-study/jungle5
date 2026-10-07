// Rounds (PRD F-06, F-09; TSD 7.1, 8.2, TD-14). Creation lives in studies.ts
// (POST /api/studies/:id/rounds); round comments in comments.ts.
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { periodOrderError, roundInfoPatchSchema, roundNotesPatchSchema } from "../../shared/schemas";
import { rounds } from "../db/schema";
import {
  parseOrThrow,
  readJson,
  roundNotEmpty,
  statusDenial,
  validationError,
  versionConflict,
} from "../lib/errors";
import { canDeleteRound, canEditRound, canSetRoundStatus, canWriteNotes, type Actor } from "../policies";
import type { AppEnv, Db } from "../types";
import { loadRoundById, loadRoundDetail, loadRoundFacts, roundFromRow } from "./studyViews";

const ACTIVE = { status: "active" } as const;

async function setRoundStatus(db: Db, actor: Actor, id: string, status: "active" | "ended") {
  const { facts } = await loadRoundFacts(db, actor, id);
  if (!canSetRoundStatus(actor, facts)) {
    throw statusDenial(canSetRoundStatus(actor, { ...facts, ...ACTIVE }), facts.status);
  }
  const [row] = await db.update(rounds).set({ status }).where(eq(rounds.id, id)).returning();
  if (!row) return loadRoundById(db, id);
  return roundFromRow(db, row);
}

/** Only the fields present in the input (undefined = unchanged). */
function definedFields<T extends Record<string, unknown>>(fields: T): Partial<T> {
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export const roundRoutes = new Hono<AppEnv>()
  .get("/:id", async (c) => c.json(await loadRoundDetail(c.get("db"), c.get("actor"), c.req.param("id"))))

  // Round info (TD-14 `infoVersion`, separate from the notes' version).
  .patch("/:id/info", async (c) => {
    const actor = c.get("actor");
    const db = c.get("db");
    const id = c.req.param("id");
    const input = parseOrThrow(roundInfoPatchSchema, await readJson(c));
    const { round, facts } = await loadRoundFacts(db, actor, id);
    if (!canEditRound(actor, facts, round)) {
      throw statusDenial(canEditRound(actor, { ...facts, ...ACTIVE }, ACTIVE), facts.status, round.status);
    }
    const { infoVersion, ...fields } = input;
    const periodError = periodOrderError(
      fields.periodStart !== undefined ? fields.periodStart : round.periodStart,
      fields.periodEnd !== undefined ? fields.periodEnd : round.periodEnd,
    );
    if (periodError) throw validationError({ periodEnd: [periodError] });

    const now = c.get("deps").now();
    const [row] = await db
      .update(rounds)
      .set({
        ...definedFields(fields),
        infoVersion: sql`${rounds.infoVersion} + 1`,
        infoUpdatedBy: actor.id,
        infoUpdatedAt: now,
      })
      .where(and(eq(rounds.id, id), eq(rounds.infoVersion, infoVersion)))
      .returning();
    if (!row) throw versionConflict(await loadRoundById(db, id));
    return c.json(await roundFromRow(db, row));
  })

  // Shared meeting notes (F-09, TSD 8.2, `notesVersion`).
  .patch("/:id/notes", async (c) => {
    const actor = c.get("actor");
    const db = c.get("db");
    const id = c.req.param("id");
    const input = parseOrThrow(roundNotesPatchSchema, await readJson(c));
    const { round, facts } = await loadRoundFacts(db, actor, id);
    if (!canWriteNotes(actor, facts, round)) {
      throw statusDenial(canWriteNotes(actor, { ...facts, ...ACTIVE }, ACTIVE), facts.status, round.status);
    }
    const { notesVersion, ...fields } = input;
    const now = c.get("deps").now();
    const [row] = await db
      .update(rounds)
      .set({
        ...definedFields(fields),
        notesVersion: sql`${rounds.notesVersion} + 1`,
        notesUpdatedBy: actor.id,
        notesUpdatedAt: now,
      })
      .where(and(eq(rounds.id, id), eq(rounds.notesVersion, notesVersion)))
      .returning();
    if (!row) throw versionConflict(await loadRoundById(db, id));
    return c.json(await roundFromRow(db, row));
  })

  .post("/:id/end", async (c) => c.json(await setRoundStatus(c.get("db"), c.get("actor"), c.req.param("id"), "ended")))
  .post("/:id/reopen", async (c) =>
    c.json(await setRoundStatus(c.get("db"), c.get("actor"), c.req.param("id"), "active")),
  )

  // Only an empty round can be deleted: no linked posts, no comments (hidden
  // ones included) and no notes. Checked inside the DELETE so a post linked or
  // a comment written meanwhile cannot be lost.
  .delete("/:id", async (c) => {
    const actor = c.get("actor");
    const db = c.get("db");
    const id = c.req.param("id");
    const { facts } = await loadRoundFacts(db, actor, id);
    if (!canDeleteRound(actor, facts)) {
      throw statusDenial(canDeleteRound(actor, { ...facts, ...ACTIVE }), facts.status);
    }
    const deleted = await db
      .delete(rounds)
      .where(
        and(
          eq(rounds.id, id),
          sql`NOT EXISTS (SELECT 1 FROM posts p WHERE p.round_id = ${id})`,
          sql`NOT EXISTS (SELECT 1 FROM comments c WHERE c.round_id = ${id})`,
          sql`COALESCE(TRIM(${rounds.notesDiscussion}), '') = ''`,
          sql`COALESCE(TRIM(${rounds.notesOpenQuestions}), '') = ''`,
          sql`COALESCE(TRIM(${rounds.notesNextActions}), '') = ''`,
        ),
      )
      .returning({ id: rounds.id });
    if (deleted.length === 0) throw roundNotEmpty();
    return c.body(null, 204);
  });
