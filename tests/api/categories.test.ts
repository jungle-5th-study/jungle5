// Categories (PRD F-02, D-17).
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { call, createPost, login, makeApp, postInput, SEED_CATEGORY_ID } from "../helpers";

const app = makeApp();

describe("categories", () => {
  it("the seeded 기타 category exists", async () => {
    const user = await login(app);
    const res = await call(app, "GET", "/api/categories", { cookie: user.cookie });
    expect(res.status).toBe(200);
    expect(res.json.items).toContainEqual(expect.objectContaining({ id: SEED_CATEGORY_ID, name: "기타", archived: false }));
  });

  it("any member can add one", async () => {
    const user = await login(app);
    const res = await call(app, "POST", "/api/categories", { cookie: user.cookie, body: { name: "Cloud Flare" } });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ name: "Cloud Flare", archived: false });
  });

  it.each(["cloudflare", "CLOUDFLARE", " Cloud  Flare ", "cloud\tflare"])(
    "rejects %j as a duplicate (case/space-insensitive) and returns the existing one",
    async (name) => {
      const user = await login(app);
      const first = await call(app, "POST", "/api/categories", { cookie: user.cookie, body: { name: "Cloud Flare" } });
      const existingId = first.status === 201 ? first.json.id : first.json.error.existing.id;
      const res = await call(app, "POST", "/api/categories", { cookie: user.cookie, body: { name } });
      expect(res.status).toBe(409);
      expect(res.json.error.code).toBe("DUPLICATE");
      expect(res.json.error.existing).toMatchObject({ id: existingId, name: "Cloud Flare" });
    },
  );

  it("validates the name (422)", async () => {
    const user = await login(app);
    const res = await call(app, "POST", "/api/categories", { cookie: user.cookie, body: { name: "   " } });
    expect(res.status).toBe(422);
    expect(res.json.error.fields.name).toBeDefined();
  });

  it("rename/archive is admin-only (403 for members)", async () => {
    const user = await login(app);
    const cat = await call(app, "POST", "/api/categories", { cookie: user.cookie, body: { name: "멤버카테고리" } });
    const rename = await call(app, "PATCH", `/api/categories/${cat.json.id}`, { cookie: user.cookie, body: { name: "새이름" } });
    expect(rename.status).toBe(403);
    const archive = await call(app, "PATCH", `/api/categories/${cat.json.id}`, { cookie: user.cookie, body: { archived: true } });
    expect(archive.status).toBe(403);
  });

  it("admin renames; existing posts keep the link (F-02)", async () => {
    const admin = await login(app, { isAdmin: true });
    const user = await login(app);
    const cat = await call(app, "POST", "/api/categories", { cookie: user.cookie, body: { name: "옛이름" } });
    const post = await createPost(app, user, { categoryId: cat.json.id });
    const res = await call(app, "PATCH", `/api/categories/${cat.json.id}`, { cookie: admin.cookie, body: { name: "새 이름" } });
    expect(res.status).toBe(200);
    expect(res.json.name).toBe("새 이름");
    const detail = await call(app, "GET", `/api/posts/${post.id}`, { cookie: user.cookie });
    expect(detail.json.category).toMatchObject({ id: cat.json.id, name: "새 이름" });
  });

  it("admin rename to an existing name → 409 DUPLICATE", async () => {
    const admin = await login(app, { isAdmin: true });
    const a = await call(app, "POST", "/api/categories", { cookie: admin.cookie, body: { name: "중복A" } });
    await call(app, "POST", "/api/categories", { cookie: admin.cookie, body: { name: "중복B" } });
    const res = await call(app, "PATCH", `/api/categories/${a.json.id}`, { cookie: admin.cookie, body: { name: "중복 b" } });
    expect(res.status).toBe(409);
    expect(res.json.error.existing.name).toBe("중복B");
  });

  it("PATCH of an unknown category → 404 (admin)", async () => {
    const admin = await login(app, { isAdmin: true });
    const res = await call(app, "PATCH", `/api/categories/01900000-0000-7000-8000-00000000ffff`, {
      cookie: admin.cookie,
      body: { archived: true },
    });
    expect(res.status).toBe(404);
  });

  it("archived categories cannot be chosen for new or edited posts, but existing posts keep them", async () => {
    const admin = await login(app, { isAdmin: true });
    const user = await login(app);
    const cat = await call(app, "POST", "/api/categories", { cookie: user.cookie, body: { name: "보관예정" } });
    const post = await createPost(app, user, { categoryId: cat.json.id });
    const other = await createPost(app, user);

    const archived = await call(app, "PATCH", `/api/categories/${cat.json.id}`, { cookie: admin.cookie, body: { archived: true } });
    expect(archived.json.archived).toBe(true);

    const create = await call(app, "POST", "/api/posts", { cookie: user.cookie, body: postInput({ categoryId: cat.json.id }) });
    expect(create.status).toBe(422);
    expect(create.json.error.fields.categoryId).toBeDefined();

    const move = await call(app, "PATCH", `/api/posts/${other.id}`, { cookie: user.cookie, body: { categoryId: cat.json.id } });
    expect(move.status).toBe(422);

    // The existing post is untouched and can still be edited without changing category.
    const keep = await call(app, "PATCH", `/api/posts/${post.id}`, { cookie: user.cookie, body: { title: "수정" } });
    expect(keep.status).toBe(200);
    expect(keep.json.category).toMatchObject({ id: cat.json.id, archived: true });

    const unarchive = await call(app, "PATCH", `/api/categories/${cat.json.id}`, { cookie: admin.cookie, body: { archived: false } });
    expect(unarchive.json.archived).toBe(false);
  });

  it("lists post counts without hidden posts, ordered by count desc then name (UD-14)", async () => {
    const admin = await login(app, { isAdmin: true });
    const user = await login(app);
    const mk = async (name: string) =>
      (await call(app, "POST", "/api/categories", { cookie: user.cookie, body: { name } })).json.id as string;
    const tag = `${Date.now()}`;
    const [b, a, c, empty] = [await mk(`B순서${tag}`), await mk(`A순서${tag}`), await mk(`C순서${tag}`), await mk(`D순서${tag}`)];
    // A: 2 visible, B: 2 visible (+1 hidden), C: 3 visible (+1 hidden), D: 0.
    for (const id of [a, a, b, b, c, c, c]) await createPost(app, user, { categoryId: id });
    for (const id of [b, c]) {
      const p = await createPost(app, user, { categoryId: id });
      expect((await call(app, "POST", `/api/posts/${p.id}/hide`, { cookie: admin.cookie })).status).toBe(204);
    }

    // Same numbers for everyone, including admins and the hidden posts' author.
    for (const viewer of [user, admin]) {
      const res = await call(app, "GET", "/api/categories", { cookie: viewer.cookie });
      expect(res.status).toBe(200);
      const items = res.json.items as { id: string; name: string; postCount: number; archived: boolean }[];
      const mine = items.filter((i) => [a, b, c, empty].includes(i.id));
      expect(mine.map((i) => [i.id, i.postCount])).toEqual([
        [c, 3],
        [a, 2],
        [b, 2],
        [empty, 0],
      ]);
      // The whole list follows the rule.
      for (let i = 1; i < items.length; i++) {
        const prev = items[i - 1]!;
        const cur = items[i]!;
        expect(prev.postCount > cur.postCount || (prev.postCount === cur.postCount && prev.name <= cur.name)).toBe(true);
      }
      // totalPosts = every post that is not hidden.
      const visible = await env.DB.prepare("SELECT count(*) AS n FROM posts WHERE hidden_at IS NULL").first<{ n: number }>();
      expect(res.json.totalPosts).toBe(visible?.n);
      expect(res.json.totalPosts).toBe(items.reduce((n, i) => n + i.postCount, 0));
      expect(Object.keys(items[0]!).sort()).toEqual(["archived", "createdAt", "id", "name", "postCount"]);
    }
  });
});
