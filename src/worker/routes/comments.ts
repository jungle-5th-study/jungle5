// Comments (PRD F-04, D-05, D-19).
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { commentCreateSchema, commentPatchSchema } from "../../shared/schemas";
import { comments, posts, rounds, studies } from "../db/schema";
import { AppError, forbidden, notFound, parseOrThrow, readJson } from "../lib/errors";
import {
  canCommentOnRound,
  canCreateComment,
  canDeleteComment,
  canEditComment,
  canHide,
  canViewContent,
  canViewStudy,
  type Actor,
} from "../policies";
import type { AppEnv, Db } from "../types";
import { loadRoundFacts } from "./studyViews";
import { commentSelect, isUniqueViolation, toComment } from "./views";

/** A comment's parent: exactly one of a post or a round (TSD 5.1). */
type Parent = { postId: string; roundId: null } | { postId: null; roundId: string };

async function loadComment(db: Db, id: string) {
  const row = await commentSelect(db).where(eq(comments.id, id)).get();
  return row ? toComment(row) : null;
}

/** TD-13 replay: same id by the same author on the same parent → existing comment (200). */
async function replayComment(db: Db, actor: Actor, id: string, parent: Parent) {
  const existing = await db
    .select({ authorId: comments.authorId, postId: comments.postId, roundId: comments.roundId })
    .from(comments)
    .where(eq(comments.id, id))
    .get();
  if (!existing) return null;
  if (existing.authorId !== actor.id || existing.postId !== parent.postId || existing.roundId !== parent.roundId) {
    throw new AppError(409, "DUPLICATE", "이미 사용된 ID입니다");
  }
  return loadComment(db, id);
}

/** Inserts a comment with TD-13 replay. Returns [comment, status]. */
async function createComment(db: Db, actor: Actor, id: string, body: string, parent: Parent, now: number) {
  const replay = await replayComment(db, actor, id, parent);
  if (replay) return [replay, 200] as const;
  try {
    await db.insert(comments).values({
      id,
      ...parent,
      authorId: actor.id,
      body,
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    // Concurrent duplicate submit: the PK rejected the second insert.
    if (isUniqueViolation(err)) {
      const again = await replayComment(db, actor, id, parent);
      if (again) return [again, 200] as const;
    }
    throw err;
  }
  return [await loadComment(db, id), 201] as const;
}

/**
 * The comment plus its parent's visibility facts, if it is visible to `actor`:
 * a post comment follows its post (TD-17), a round comment its study (hidden
 * studies are admin-only).
 */
async function loadAccessibleComment(db: Db, actor: Actor, id: string) {
  const row = await db
    .select({
      id: comments.id,
      authorId: comments.authorId,
      hiddenAt: comments.hiddenAt,
      postAuthorId: posts.authorId,
      postHiddenAt: posts.hiddenAt,
      roundId: rounds.id,
      studyHiddenAt: studies.hiddenAt,
    })
    .from(comments)
    .leftJoin(posts, eq(posts.id, comments.postId))
    .leftJoin(rounds, eq(rounds.id, comments.roundId))
    .leftJoin(studies, eq(studies.id, rounds.studyId))
    .where(eq(comments.id, id))
    .get();
  if (!row || !canViewContent(actor, row)) throw notFound();
  if (row.postAuthorId !== null && !canViewContent(actor, { authorId: row.postAuthorId, hiddenAt: row.postHiddenAt })) {
    throw notFound();
  }
  if (row.roundId !== null && !canViewStudy(actor, { hiddenAt: row.studyHiddenAt })) throw notFound();
  return row;
}

async function setCommentHidden(db: Db, actor: Actor, id: string, hiddenAt: number | null) {
  if (!canHide(actor)) throw forbidden();
  const res = await db
    .update(comments)
    .set({ hiddenAt, hiddenBy: hiddenAt === null ? null : actor.id })
    .where(eq(comments.id, id))
    .returning({ id: comments.id });
  if (res.length === 0) throw notFound();
}

export const commentRoutes = new Hono<AppEnv>()
  .post("/posts/:postId/comments", async (c) => {
    const actor = c.get("actor");
    if (!canCreateComment(actor)) throw forbidden();
    const db = c.get("db");
    const postId = c.req.param("postId");
    const input = parseOrThrow(commentCreateSchema, await readJson(c));
    const post = await db
      .select({ authorId: posts.authorId, hiddenAt: posts.hiddenAt })
      .from(posts)
      .where(eq(posts.id, postId))
      .get();
    if (!post || !canViewContent(actor, post)) throw notFound();
    const parent: Parent = { postId, roundId: null };
    const [comment, status] = await createComment(db, actor, input.id, input.body, parent, c.get("deps").now());
    return c.json(comment, status);
  })

  // F-09 round comments (personal retrospectives): any community member, also
  // on ended rounds and ended studies (F-06).
  .post("/rounds/:roundId/comments", async (c) => {
    const actor = c.get("actor");
    if (!canCommentOnRound(actor)) throw forbidden();
    const db = c.get("db");
    const roundId = c.req.param("roundId");
    const input = parseOrThrow(commentCreateSchema, await readJson(c));
    await loadRoundFacts(db, actor, roundId); // 404 when missing or its study is hidden
    const parent: Parent = { postId: null, roundId };
    const [comment, status] = await createComment(db, actor, input.id, input.body, parent, c.get("deps").now());
    return c.json(comment, status);
  })

  .patch("/comments/:id", async (c) => {
    const actor = c.get("actor");
    const db = c.get("db");
    const id = c.req.param("id");
    const input = parseOrThrow(commentPatchSchema, await readJson(c));
    const comment = await loadAccessibleComment(db, actor, id);
    if (!canEditComment(actor, comment)) throw forbidden();
    await db
      .update(comments)
      .set({ body: input.body, updatedAt: c.get("deps").now() })
      .where(eq(comments.id, id));
    return c.json(await loadComment(db, id));
  })

  .delete("/comments/:id", async (c) => {
    const actor = c.get("actor");
    const db = c.get("db");
    const id = c.req.param("id");
    const comment = await loadAccessibleComment(db, actor, id);
    if (!canDeleteComment(actor, comment)) throw forbidden();
    await db.delete(comments).where(eq(comments.id, id));
    return c.body(null, 204);
  })

  .post("/comments/:id/hide", async (c) => {
    await setCommentHidden(c.get("db"), c.get("actor"), c.req.param("id"), c.get("deps").now());
    return c.body(null, 204);
  })
  .post("/comments/:id/unhide", async (c) => {
    await setCommentHidden(c.get("db"), c.get("actor"), c.req.param("id"), null);
    return c.body(null, 204);
  });
