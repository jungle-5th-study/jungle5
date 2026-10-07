// Categories (PRD F-02, D-17).
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Category, CategoryList } from "../../shared/api";
import { nameKey, uuidv7 } from "../../shared/ids";
import { categoryCreateSchema, categoryPatchSchema } from "../../shared/schemas";
import { categories, type CategoryRow } from "../db/schema";
import { AppError, forbidden, notFound, parseOrThrow, readJson } from "../lib/errors";
import { canCreateCategory, canManageCategory } from "../policies";
import type { AppEnv } from "../types";

const toCategory = (r: CategoryRow): Category => ({
  id: r.id,
  name: r.name,
  archived: r.archivedAt !== null,
  createdAt: r.createdAt,
});

const duplicate = (existing: CategoryRow) =>
  new AppError(409, "DUPLICATE", "같은 이름의 카테고리가 이미 있습니다", { existing: toCategory(existing) });

export const categoryRoutes = new Hono<AppEnv>()
  // All categories incl. archived (existing posts still show them); the SPA
  // offers only non-archived ones when writing. UD-14: each with its number of
  // posts that are not hidden, most posts first, then by name. The same count
  // for every viewer (hidden posts are excluded even for admins/authors) so the
  // tabs stay stable. 1 query.
  .get("/", async (c) => {
    // Raw names on purpose: in a single-table select Drizzle renders columns
    // unqualified, which would bind `id` inside the subquery to posts.id.
    const postCount = sql<number>`(SELECT count(*) FROM posts p WHERE p.category_id = categories.id AND p.hidden_at IS NULL)`;
    const rows = await c
      .get("db")
      .select({ category: categories, postCount })
      .from(categories)
      .orderBy(desc(postCount), asc(categories.name));
    const items = rows.map((r) => ({ ...toCategory(r.category), postCount: Number(r.postCount) }));
    // Every post has exactly one category, so the sum is the total of visible posts.
    const body: CategoryList = { items, totalPosts: items.reduce((n, i) => n + i.postCount, 0) };
    return c.json(body);
  })

  .post("/", async (c) => {
    const actor = c.get("actor");
    if (!canCreateCategory(actor)) throw forbidden();
    const input = parseOrThrow(categoryCreateSchema, await readJson(c));
    const db = c.get("db");
    const key = nameKey(input.name);
    const now = c.get("deps").now();
    const inserted = await db
      .insert(categories)
      .values({ id: uuidv7(now), name: input.name, nameKey: key, createdBy: actor.id, createdAt: now })
      .onConflictDoNothing({ target: categories.nameKey })
      .returning();
    if (inserted[0]) return c.json(toCategory(inserted[0]), 201);
    const existing = await db.select().from(categories).where(eq(categories.nameKey, key)).get();
    if (!existing) throw new Error("category conflict without existing row");
    throw duplicate(existing);
  })

  .patch("/:id", async (c) => {
    const actor = c.get("actor");
    if (!canManageCategory(actor)) throw forbidden();
    const input = parseOrThrow(categoryPatchSchema, await readJson(c));
    const db = c.get("db");
    const id = c.req.param("id");
    const current = await db.select().from(categories).where(eq(categories.id, id)).get();
    if (!current) throw notFound();

    const update: Partial<CategoryRow> = {};
    if (input.name !== undefined) {
      const key = nameKey(input.name);
      const clash = await db
        .select()
        .from(categories)
        .where(and(eq(categories.nameKey, key), ne(categories.id, id)))
        .get();
      if (clash) throw duplicate(clash);
      update.name = input.name;
      update.nameKey = key;
    }
    if (input.archived !== undefined) {
      update.archivedAt = input.archived ? (current.archivedAt ?? c.get("deps").now()) : null;
    }
    try {
      const [row] = await db.update(categories).set(update).where(eq(categories.id, id)).returning();
      if (!row) throw notFound();
      return c.json(toCategory(row));
    } catch (err) {
      // Lost a race with a concurrent create of the same name.
      if (update.nameKey && /UNIQUE/i.test(String(err))) {
        const clash = await db.select().from(categories).where(eq(categories.nameKey, update.nameKey)).get();
        if (clash) throw duplicate(clash);
      }
      throw err;
    }
  });
