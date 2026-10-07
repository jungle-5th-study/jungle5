// Studies (PRD F-05, D-23, D-24; TSD 7.1, TD-14, TD-23) and round creation (F-06).
import { and, eq, ne, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { StudyList } from "../../shared/api";
import {
  roundCreateSchema,
  studyCreateSchema,
  studyListQuerySchema,
  studyPatchSchema,
  studyRoleSchema,
} from "../../shared/schemas";
import { studyRecomputeStatements } from "../auth/studyRoles";
import { rounds, studies, type StudyRow } from "../db/schema";
import { AppError, forbidden, notFound, parseOrThrow, readJson, statusDenial, versionConflict } from "../lib/errors";
import {
  canChangeStudyRole,
  canCreateRound,
  canCreateStudy,
  canEditStudy,
  canEndStudy,
  canHide,
  type Actor,
} from "../policies";
import type { AppEnv, Db } from "../types";
import { loadStudy, loadStudyDetail, listStudies, roundFromRow } from "./studyViews";
import { isUniqueViolation } from "./views";

const roleTaken = (existing: Pick<StudyRow, "id" | "name">) =>
  new AppError(409, "DUPLICATE", "이 Discord 역할은 이미 다른 스터디에 연결되어 있습니다", {
    existing: { id: existing.id, name: existing.name },
  });

/** Another study already linked to `roleId` (excluding `exceptId`). 1 query. */
async function studyWithRole(db: Db, roleId: string, exceptId: string) {
  return db
    .select({ id: studies.id, name: studies.name })
    .from(studies)
    .where(and(eq(studies.discordRoleId, roleId), ne(studies.id, exceptId)))
    .get();
}

async function setStudyStatus(db: Db, actor: Actor, id: string, status: "active" | "ended", now: number) {
  if (!canEndStudy(actor)) throw forbidden();
  await loadStudy(db, actor, id);
  await db.update(studies).set({ status, updatedAt: now }).where(eq(studies.id, id));
  return loadStudyDetail(db, actor, id);
}

async function setStudyHidden(db: Db, actor: Actor, id: string, hiddenAt: number | null) {
  if (!canHide(actor)) throw forbidden();
  const res = await db
    .update(studies)
    .set({ hiddenAt, hiddenBy: hiddenAt === null ? null : actor.id })
    .where(eq(studies.id, id))
    .returning({ id: studies.id });
  if (res.length === 0) throw notFound();
}

export const studyRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const query = parseOrThrow(studyListQuerySchema, c.req.query());
    const items = await listStudies(c.get("db"), c.get("actor"), query.status, c.get("deps").now());
    const body: StudyList = { items };
    return c.json(body);
  })

  // Admin creates a study linked to a Discord role; its members are computed
  // right away from the role IDs stored at each member's last check (TSD 3.2).
  .post("/", async (c) => {
    const actor = c.get("actor");
    if (!canCreateStudy(actor)) throw forbidden();
    const input = parseOrThrow(studyCreateSchema, await readJson(c));
    const db = c.get("db");

    /** TD-13 replay (same id → existing study, 200) or a taken role (409). */
    const checkExisting = async () => {
      const clashes = await db
        .select({ id: studies.id, name: studies.name, discordRoleId: studies.discordRoleId })
        .from(studies)
        .where(or(eq(studies.id, input.id), eq(studies.discordRoleId, input.discordRoleId)));
      if (clashes.some((s) => s.id === input.id)) return loadStudyDetail(db, actor, input.id);
      const taken = clashes.find((s) => s.discordRoleId === input.discordRoleId);
      if (taken) throw roleTaken(taken);
      return null;
    };
    const replay = await checkExisting();
    if (replay) return c.json(replay, 200);

    const now = c.get("deps").now();
    try {
      await db.batch([
        db.insert(studies).values({
          id: input.id,
          name: input.name,
          goal: input.goal,
          description: input.description,
          materials: input.materials,
          cadence: input.cadence,
          joinGuide: input.joinGuide,
          discordRoleId: input.discordRoleId,
          status: "active",
          version: 1,
          createdAt: now,
          updatedAt: now,
        }),
        ...studyRecomputeStatements(db, input.id, input.discordRoleId, now),
      ]);
    } catch (err) {
      // Lost a race: a concurrent create with the same id or role.
      if (isUniqueViolation(err)) {
        const again = await checkExisting();
        if (again) return c.json(again, 200);
      }
      throw err;
    }
    return c.json(await loadStudyDetail(db, actor, input.id), 201);
  })

  .get("/:id", async (c) => c.json(await loadStudyDetail(c.get("db"), c.get("actor"), c.req.param("id"))))

  // Study info (TD-14 `version`). Study members or admin, any study status (D-24).
  .patch("/:id", async (c) => {
    const actor = c.get("actor");
    const db = c.get("db");
    const id = c.req.param("id");
    const input = parseOrThrow(studyPatchSchema, await readJson(c));
    const loaded = await loadStudy(db, actor, id);
    if (!canEditStudy(actor, loaded.facts)) throw forbidden();

    const { version, ...fields } = input;
    const set = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    const updated = await db
      .update(studies)
      .set({ ...set, version: sql`${studies.version} + 1`, updatedAt: c.get("deps").now() })
      .where(and(eq(studies.id, id), eq(studies.version, version)))
      .returning({ id: studies.id });
    const detail = await loadStudyDetail(db, actor, id);
    if (updated.length === 0) throw versionConflict(detail);
    return c.json(detail);
  })

  // Admin links a different Discord role; members are recomputed at once.
  .put("/:id/role", async (c) => {
    const actor = c.get("actor");
    if (!canChangeStudyRole(actor)) throw forbidden();
    const db = c.get("db");
    const id = c.req.param("id");
    const input = parseOrThrow(studyRoleSchema, await readJson(c));
    await loadStudy(db, actor, id);
    const taken = await studyWithRole(db, input.discordRoleId, id);
    if (taken) throw roleTaken(taken);
    const now = c.get("deps").now();
    try {
      await db.batch([
        db.update(studies).set({ discordRoleId: input.discordRoleId, updatedAt: now }).where(eq(studies.id, id)),
        ...studyRecomputeStatements(db, id, input.discordRoleId, now),
      ]);
    } catch (err) {
      if (isUniqueViolation(err)) {
        const clash = await studyWithRole(db, input.discordRoleId, id);
        if (clash) throw roleTaken(clash);
      }
      throw err;
    }
    return c.json(await loadStudyDetail(db, actor, id));
  })

  .post("/:id/end", async (c) =>
    c.json(await setStudyStatus(c.get("db"), c.get("actor"), c.req.param("id"), "ended", c.get("deps").now())),
  )
  .post("/:id/reopen", async (c) =>
    c.json(await setStudyStatus(c.get("db"), c.get("actor"), c.req.param("id"), "active", c.get("deps").now())),
  )

  .post("/:id/hide", async (c) => {
    await setStudyHidden(c.get("db"), c.get("actor"), c.req.param("id"), c.get("deps").now());
    return c.body(null, 204);
  })
  .post("/:id/unhide", async (c) => {
    await setStudyHidden(c.get("db"), c.get("actor"), c.req.param("id"), null);
    return c.body(null, 204);
  })

  // Round creation (F-06): study member or admin while the study is active.
  // seq = max + 1, computed inside the INSERT so concurrent creates cannot
  // pick the same number; a UNIQUE(study_id, seq) clash is retried once.
  .post("/:id/rounds", async (c) => {
    const actor = c.get("actor");
    const db = c.get("db");
    const studyId = c.req.param("id");
    const input = parseOrThrow(roundCreateSchema, await readJson(c));
    const loaded = await loadStudy(db, actor, studyId);

    /** TD-13: same id by the same creator in the same study → existing round (200). */
    const replay = async () => {
      const existing = await db.select().from(rounds).where(eq(rounds.id, input.id)).get();
      if (!existing) return null;
      if (existing.createdBy !== actor.id || existing.studyId !== studyId) {
        throw new AppError(409, "DUPLICATE", "이미 사용된 ID입니다");
      }
      return roundFromRow(db, existing);
    };
    const existing = await replay();
    if (existing) return c.json(existing, 200);

    if (!canCreateRound(actor, loaded.facts)) {
      throw statusDenial(canCreateRound(actor, { ...loaded.facts, status: "active" }), loaded.facts.status);
    }
    const now = c.get("deps").now();
    const insert = () =>
      db
        .insert(rounds)
        .values({
          id: input.id,
          studyId,
          seq: sql`(SELECT COALESCE(MAX(r.seq), 0) + 1 FROM rounds r WHERE r.study_id = ${studyId})`,
          title: input.title,
          scope: input.scope,
          goal: input.goal,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          meetingAt: input.meetingAt,
          location: input.location,
          materials: input.materials,
          status: "active",
          infoVersion: 1,
          notesVersion: 1,
          createdBy: actor.id,
          createdAt: now,
        })
        .returning();
    for (let attempt = 0; ; attempt++) {
      try {
        const [row] = await insert();
        if (!row) throw new Error("round insert returned no row");
        return c.json(await roundFromRow(db, row), 201);
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        const again = await replay(); // a concurrent retry of the same request
        if (again) return c.json(again, 200);
        if (attempt >= 1) {
          throw new AppError(409, "DUPLICATE", "다른 멤버가 동시에 회차를 만들었습니다. 다시 시도하세요");
        }
      }
    }
  });
