// Posts (PRD F-03, F-04; TSD 7.1, 7.2, 8.1).
import { and, eq, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { LIMITS } from "../../shared/constants";
import { nameKey, uuidv7 } from "../../shared/ids";
import { postCreateSchema, postListQuerySchema, postPatchSchema, postRoundSchema } from "../../shared/schemas";
import { categories, posts, postTags, tags } from "../db/schema";
import {
  AppError,
  forbidden,
  notFound,
  parseOrThrow,
  readJson,
  statusDenial,
  validationError,
} from "../lib/errors";
import {
  canCreatePost,
  canDeletePost,
  canEditPost,
  canHide,
  canLinkPostToRound,
  canUnlinkPostFromRound,
  canViewContent,
  type Actor,
  type OwnedContent,
} from "../policies";
import type { AppEnv, Db } from "../types";
import { loadRoundFacts } from "./studyViews";
import {
  decodeCursor,
  encodeCursor,
  isUniqueViolation,
  likeContains,
  listPosts,
  loadPostDetail,
} from "./views";

async function assertSelectableCategory(db: Db, categoryId: string) {
  const cat = await db
    .select({ archivedAt: categories.archivedAt })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .get();
  if (!cat) throw validationError({ categoryId: ["존재하지 않는 카테고리입니다"] });
  if (cat.archivedAt !== null) throw validationError({ categoryId: ["보관된 카테고리는 선택할 수 없습니다"] });
}

/**
 * F-08, D-15: `post`'s author may link it to `roundId` only as a member of the
 * round's study, and only while the study and the round are active.
 * Unknown or invisible round → 422 on `roundId`. 1 query.
 */
async function assertLinkable(db: Db, actor: Actor, post: OwnedContent, roundId: string) {
  const loaded = await loadRoundFacts(db, actor, roundId).catch((err: unknown) => {
    if (err instanceof AppError && err.code === "NOT_FOUND") {
      throw validationError({ roundId: ["존재하지 않는 회차입니다"] });
    }
    throw err;
  });
  const { facts, round } = loaded;
  if (!canLinkPostToRound(actor, post, facts, round)) {
    const ifActive = canLinkPostToRound(actor, post, { ...facts, status: "active" }, { status: "active" });
    throw statusDenial(ifActive, facts.status, round.status);
  }
}

/** Deduplicated (by name key) tag list, first spelling wins. */
function uniqueTags(names: string[]): { name: string; key: string }[] {
  const seen = new Map<string, string>();
  for (const name of names) {
    const key = nameKey(name);
    if (key && !seen.has(key)) seen.set(key, name.trim());
  }
  return [...seen].map(([key, name]) => ({ key, name }));
}

/** Statements that auto-create tags and link them to the post (2 statements). */
function tagStatements(db: Db, postId: string, tagList: { name: string; key: string }[], now: number) {
  if (tagList.length === 0) return [];
  const keys = tagList.map((t) => t.key);
  return [
    db
      .insert(tags)
      .values(tagList.map((t) => ({ id: uuidv7(now), name: t.name, nameKey: t.key })))
      .onConflictDoNothing({ target: tags.nameKey }),
    db
      .insert(postTags)
      .select(
        db
          .select({ postId: sql<string>`${postId}`.as("post_id"), tagId: tags.id })
          .from(tags)
          .where(inArray(tags.nameKey, keys)),
      )
      .onConflictDoNothing(),
  ] as const;
}

/** TD-13: same id + same author → return the existing post (200). */
async function replayExisting(c: { get: (k: "db") => Db }, actor: Actor, id: string) {
  const db = c.get("db");
  const existing = await db.select({ authorId: posts.authorId }).from(posts).where(eq(posts.id, id)).get();
  if (!existing) return null;
  if (existing.authorId !== actor.id) {
    throw new AppError(409, "DUPLICATE", "이미 사용된 ID입니다");
  }
  return loadPostDetail(db, actor, id);
}

async function loadOwnedPost(db: Db, actor: Actor, id: string) {
  const post = await db.select().from(posts).where(eq(posts.id, id)).get();
  if (!post || !canViewContent(actor, post)) throw notFound();
  return post;
}

export const postRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const actor = c.get("actor");
    const query = parseOrThrow(postListQuerySchema, c.req.query());
    const filters: (SQL | undefined)[] = [];
    if (query.q) {
      const pattern = likeContains(query.q);
      filters.push(
        or(sql`${posts.title} LIKE ${pattern} ESCAPE '\\'`, sql`${posts.body} LIKE ${pattern} ESCAPE '\\'`),
      );
    }
    if (query.category) filters.push(eq(posts.categoryId, query.category));
    if (query.round) filters.push(eq(posts.roundId, query.round));
    if (query.tag) {
      filters.push(
        sql`EXISTS (SELECT 1 FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.post_id = ${posts.id} AND t.name_key = ${nameKey(query.tag)})`,
      );
    }
    if (query.cursor) {
      const cur = decodeCursor(query.cursor);
      if (!cur) throw validationError({ cursor: ["잘못된 커서입니다"] });
      filters.push(
        or(lt(posts.createdAt, cur.createdAt), and(eq(posts.createdAt, cur.createdAt), lt(posts.id, cur.id))),
      );
    }
    const { items, hasMore } = await listPosts(c.get("db"), actor, filters, LIMITS.pageSize);
    const last = items[items.length - 1];
    return c.json({ items, nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null });
  })

  .post("/", async (c) => {
    const actor = c.get("actor");
    if (!canCreatePost(actor)) throw forbidden();
    const input = parseOrThrow(postCreateSchema, await readJson(c));
    const db = c.get("db");
    const roundId = input.roundId ?? null;

    const replay = await replayExisting(c, actor, input.id);
    if (replay) return c.json(replay, 200);
    await assertSelectableCategory(db, input.categoryId);
    if (roundId) await assertLinkable(db, actor, { authorId: actor.id }, roundId);

    const now = c.get("deps").now();
    try {
      await db.batch([
        db.insert(posts).values({
          id: input.id,
          title: input.title,
          body: input.body,
          categoryId: input.categoryId,
          authorId: actor.id,
          roundId,
          links: JSON.stringify(input.links),
          createdAt: now,
          updatedAt: now,
        }),
        ...tagStatements(db, input.id, uniqueTags(input.tags), now),
      ]);
    } catch (err) {
      // Concurrent duplicate submit: the PK rejected the second insert (TD-13).
      if (isUniqueViolation(err)) {
        const again = await replayExisting(c, actor, input.id);
        if (again) return c.json(again, 200);
      }
      throw err;
    }
    const detail = await loadPostDetail(db, actor, input.id);
    return c.json(detail, 201);
  })

  .get("/:id", async (c) => {
    const detail = await loadPostDetail(c.get("db"), c.get("actor"), c.req.param("id"));
    if (!detail) throw notFound();
    return c.json(detail);
  })

  .patch("/:id", async (c) => {
    const actor = c.get("actor");
    const db = c.get("db");
    const id = c.req.param("id");
    const input = parseOrThrow(postPatchSchema, await readJson(c));
    const post = await loadOwnedPost(db, actor, id);
    if (!canEditPost(actor, post)) throw forbidden();

    if (input.categoryId !== undefined && input.categoryId !== post.categoryId) {
      await assertSelectableCategory(db, input.categoryId);
    }
    const now = c.get("deps").now();
    const update = db
      .update(posts)
      .set({
        title: input.title ?? post.title,
        body: input.body ?? post.body,
        categoryId: input.categoryId ?? post.categoryId,
        ...(input.links !== undefined && { links: JSON.stringify(input.links) }),
        updatedAt: now,
      })
      .where(eq(posts.id, id));
    if (input.tags !== undefined) {
      await db.batch([
        update,
        db.delete(postTags).where(eq(postTags.postId, id)),
        ...tagStatements(db, id, uniqueTags(input.tags), now),
      ]);
    } else {
      await update;
    }
    return c.json(await loadPostDetail(db, actor, id));
  })

  .delete("/:id", async (c) => {
    const actor = c.get("actor");
    const db = c.get("db");
    const id = c.req.param("id");
    const post = await loadOwnedPost(db, actor, id);
    if (!canDeletePost(actor, post)) throw forbidden();
    // Comments and post_tags go with it (ON DELETE CASCADE, D-19).
    await db.delete(posts).where(eq(posts.id, id));
    return c.body(null, 204);
  })

  // F-08 round link/unlink. Linking: the author as a member of the round's
  // study, active round only (D-15). Unlinking: the author, always (losing the
  // study role keeps old links but never traps them). Not a content edit, so
  // updated_at is left alone.
  .put("/:id/round", async (c) => {
    const actor = c.get("actor");
    const db = c.get("db");
    const id = c.req.param("id");
    const input = parseOrThrow(postRoundSchema, await readJson(c));
    const post = await loadOwnedPost(db, actor, id);
    if (input.roundId === null) {
      if (!canUnlinkPostFromRound(actor, post)) throw forbidden();
    } else if (input.roundId !== post.roundId) {
      await assertLinkable(db, actor, post, input.roundId);
    } else if (!canEditPost(actor, post)) {
      throw forbidden(); // re-linking the same round: still the author only
    }
    await db.update(posts).set({ roundId: input.roundId }).where(eq(posts.id, id));
    return c.json(await loadPostDetail(db, actor, id));
  })

  .post("/:id/hide", async (c) => setPostHidden(c.get("db"), c.get("actor"), c.req.param("id"), c.get("deps").now()).then(() => c.body(null, 204)))
  .post("/:id/unhide", async (c) => setPostHidden(c.get("db"), c.get("actor"), c.req.param("id"), null).then(() => c.body(null, 204)));

async function setPostHidden(db: Db, actor: Actor, id: string, hiddenAt: number | null) {
  if (!canHide(actor)) throw forbidden();
  const res = await db
    .update(posts)
    .set({ hiddenAt, hiddenBy: hiddenAt === null ? null : actor.id })
    .where(eq(posts.id, id))
    .returning({ id: posts.id });
  if (res.length === 0) throw notFound();
}
