// Posts & comments (PRD F-03, F-04, F-10; TSD 7, 8.1, TD-13, TD-17).
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { call, createPost, login, makeApp, postInput, uuidv7 } from "../helpers";

const app = makeApp();

async function count(sql: string, ...params: unknown[]): Promise<number> {
  const row = await env.DB.prepare(sql)
    .bind(...params)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe("post CRUD", () => {
  it("creates, reads, updates and deletes a post", async () => {
    const user = await login(app, { displayName: "작성자" });
    const input = postInput({ title: "Hono 정리", body: "# 제목\n본문", tags: ["Hono", "workers"] });
    const created = await call(app, "POST", "/api/posts", { cookie: user.cookie, body: input });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({
      id: input.id,
      title: "Hono 정리",
      author: { id: user.memberId, displayName: "작성자", withdrawn: false },
      tags: ["Hono", "workers"],
      links: [],
      hidden: false,
      comments: [],
    });
    // D-22: posts have no kind or question fields.
    for (const gone of ["kind", "recommendReason", "questionStatus", "resolutionSummary"]) {
      expect(created.json).not.toHaveProperty(gone);
    }

    const reader = await login(app);
    const read = await call(app, "GET", `/api/posts/${input.id}`, { cookie: reader.cookie });
    expect(read.status).toBe(200);
    expect(read.json.body).toBe("# 제목\n본문");

    const patched = await call(app, "PATCH", `/api/posts/${input.id}`, {
      cookie: user.cookie,
      body: { title: "Hono 정리 v2", tags: ["hono", "D1"] },
    });
    expect(patched.status).toBe(200);
    expect(patched.json.title).toBe("Hono 정리 v2");
    // "hono" maps to the existing "Hono" tag (case-insensitive key).
    expect(patched.json.tags).toEqual(["D1", "Hono"]);

    const del = await call(app, "DELETE", `/api/posts/${input.id}`, { cookie: user.cookie });
    expect(del.status).toBe(204);
    expect((await call(app, "GET", `/api/posts/${input.id}`, { cookie: user.cookie })).status).toBe(404);
  });

  it("only the author can edit or delete (403 for others, admins included)", async () => {
    const author = await login(app);
    const other = await login(app);
    const admin = await login(app, { isAdmin: true });
    const post = await createPost(app, author);
    for (const u of [other, admin]) {
      expect((await call(app, "PATCH", `/api/posts/${post.id}`, { cookie: u.cookie, body: { title: "탈취" } })).status).toBe(403);
      expect((await call(app, "DELETE", `/api/posts/${post.id}`, { cookie: u.cookie })).status).toBe(403);
    }
    const still = await call(app, "GET", `/api/posts/${post.id}`, { cookie: author.cookie });
    expect(still.json.title).toBe("테스트 글");
  });

  it("unknown post → 404", async () => {
    const user = await login(app);
    expect((await call(app, "GET", `/api/posts/${uuidv7()}`, { cookie: user.cookie })).status).toBe(404);
    expect((await call(app, "PATCH", `/api/posts/${uuidv7()}`, { cookie: user.cookie, body: { title: "x" } })).status).toBe(404);
    expect((await call(app, "DELETE", `/api/posts/${uuidv7()}`, { cookie: user.cookie })).status).toBe(404);
  });
});

describe("duplicate create (TD-13)", () => {
  it("the same id twice returns the existing post and creates no second row", async () => {
    const user = await login(app);
    const input = postInput({ tags: ["dup"] });
    const first = await call(app, "POST", "/api/posts", { cookie: user.cookie, body: input });
    const second = await call(app, "POST", "/api/posts", { cookie: user.cookie, body: { ...input, title: "다른 제목" } });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.json.id).toBe(input.id);
    expect(second.json.title).toBe(input.title);
    expect(await count("SELECT count(*) AS n FROM posts WHERE id = ?", input.id)).toBe(1);
    expect(await count("SELECT count(*) AS n FROM post_tags WHERE post_id = ?", input.id)).toBe(1);
  });

  it("concurrent duplicate submits produce a single row", async () => {
    const user = await login(app);
    const input = postInput();
    const results = await Promise.all([
      call(app, "POST", "/api/posts", { cookie: user.cookie, body: input }),
      call(app, "POST", "/api/posts", { cookie: user.cookie, body: input }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(await count("SELECT count(*) AS n FROM posts WHERE id = ?", input.id)).toBe(1);
  });

  it("another member reusing the id gets 409", async () => {
    const a = await login(app);
    const b = await login(app);
    const input = postInput();
    await call(app, "POST", "/api/posts", { cookie: a.cookie, body: input });
    const res = await call(app, "POST", "/api/posts", { cookie: b.cookie, body: input });
    expect(res.status).toBe(409);
  });

  it("the same comment id twice returns the existing comment", async () => {
    const user = await login(app);
    const post = await createPost(app, user);
    const body = { id: uuidv7(), body: "댓글" };
    const first = await call(app, "POST", `/api/posts/${post.id}/comments`, { cookie: user.cookie, body });
    const second = await call(app, "POST", `/api/posts/${post.id}/comments`, { cookie: user.cookie, body });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(await count("SELECT count(*) AS n FROM comments WHERE id = ?", body.id)).toBe(1);
  });
});

describe("delete cascade (D-19)", () => {
  it("deleting a post removes its comments and tag links", async () => {
    const user = await login(app);
    const other = await login(app);
    const post = await createPost(app, user, { tags: ["cascade-a", "cascade-b"] });
    await call(app, "POST", `/api/posts/${post.id}/comments`, { cookie: other.cookie, body: { id: uuidv7(), body: "c1" } });
    await call(app, "POST", `/api/posts/${post.id}/comments`, { cookie: user.cookie, body: { id: uuidv7(), body: "c2" } });
    expect(await count("SELECT count(*) AS n FROM comments WHERE post_id = ?", post.id)).toBe(2);
    expect(await count("SELECT count(*) AS n FROM post_tags WHERE post_id = ?", post.id)).toBe(2);

    expect((await call(app, "DELETE", `/api/posts/${post.id}`, { cookie: user.cookie })).status).toBe(204);
    expect(await count("SELECT count(*) AS n FROM comments WHERE post_id = ?", post.id)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM post_tags WHERE post_id = ?", post.id)).toBe(0);
    const list = await call(app, "GET", "/api/posts?tag=cascade-a", { cookie: user.cookie });
    expect(list.json.items).toEqual([]);
  });
});

describe("validation (F-03, 422)", () => {
  it("returns the VALIDATION shape with field errors", async () => {
    const user = await login(app);
    const res = await call(app, "POST", "/api/posts", {
      cookie: user.cookie,
      body: { id: "not-a-uuid", title: "", body: "", categoryId: "x" },
    });
    expect(res.status).toBe(422);
    expect(res.json.error.code).toBe("VALIDATION");
    expect(typeof res.json.error.message).toBe("string");
    expect(Object.keys(res.json.error.fields)).toEqual(expect.arrayContaining(["id", "title", "body", "categoryId"]));
    for (const messages of Object.values(res.json.error.fields)) {
      expect(messages).toEqual(expect.arrayContaining([expect.any(String)]));
    }
  });

  it("rejects malformed JSON with 422", async () => {
    const user = await login(app);
    const res = await app.request(
      "/api/posts",
      {
        method: "POST",
        headers: { Cookie: user.cookie, Origin: env.APP_ORIGIN, "Content-Type": "application/json" },
        body: "{oops",
      },
      env,
    );
    expect(res.status).toBe(422);
  });

  it("links are optional; given links are stored", async () => {
    const user = await login(app);
    const bare = await call(app, "POST", "/api/posts", { cookie: user.cookie, body: postInput() });
    expect(bare.status).toBe(201);
    expect(bare.json.links).toEqual([]);
    const ok = await call(app, "POST", "/api/posts", {
      cookie: user.cookie,
      body: postInput({ links: [{ url: "https://hono.dev", label: "Hono" }] }),
    });
    expect(ok.status).toBe(201);
    expect(ok.json.links).toEqual([{ url: "https://hono.dev", label: "Hono" }]);
    // PATCH without links keeps them; with links replaces them.
    const kept = await call(app, "PATCH", `/api/posts/${ok.json.id}`, { cookie: user.cookie, body: { title: "t2" } });
    expect(kept.json.links).toEqual([{ url: "https://hono.dev", label: "Hono" }]);
    const cleared = await call(app, "PATCH", `/api/posts/${ok.json.id}`, { cookie: user.cookie, body: { links: [] } });
    expect(cleared.json.links).toEqual([]);
  });

  it.each(["javascript:alert(1)", "ftp://example.com/x", "data:text/html,hi", "not a url"])(
    "rejects non-http(s) link %j",
    async (url) => {
      const user = await login(app);
      const res = await call(app, "POST", "/api/posts", { cookie: user.cookie, body: postInput({ links: [{ url }] }) });
      expect(res.status).toBe(422);
      expect(Object.keys(res.json.error.fields)[0]).toMatch(/^links\.0\.url$/);
    },
  );

  it("allows at most 10 links and 10 tags", async () => {
    const user = await login(app);
    const links = Array.from({ length: 11 }, (_, i) => ({ url: `https://e.com/${i}` }));
    expect((await call(app, "POST", "/api/posts", { cookie: user.cookie, body: postInput({ links }) })).status).toBe(422);
    const tags = Array.from({ length: 11 }, (_, i) => `t${i}`);
    expect((await call(app, "POST", "/api/posts", { cookie: user.cookie, body: postInput({ tags }) })).status).toBe(422);
    const ok = await call(app, "POST", "/api/posts", {
      cookie: user.cookie,
      body: postInput({ links: links.slice(0, 10), tags: tags.slice(0, 10) }),
    });
    expect(ok.status).toBe(201);
    expect(ok.json.tags).toHaveLength(10);
  });

  it("removed kind fields are ignored, not stored (D-22)", async () => {
    const user = await login(app);
    const res = await call(app, "POST", "/api/posts", {
      cookie: user.cookie,
      body: postInput({ kind: "question", questionStatus: "open", recommendReason: "무시됨" }),
    });
    expect(res.status).toBe(201);
    expect(res.json).not.toHaveProperty("kind");
    expect(res.json).not.toHaveProperty("questionStatus");
    expect(res.json).not.toHaveProperty("recommendReason");
  });

  it("an unknown category → 422", async () => {
    const user = await login(app);
    const res = await call(app, "POST", "/api/posts", { cookie: user.cookie, body: postInput({ categoryId: uuidv7() }) });
    expect(res.status).toBe(422);
    expect(res.json.error.fields.categoryId).toBeDefined();
  });

  it("an unknown round at creation → 422 on roundId", async () => {
    const user = await login(app);
    const res = await call(app, "POST", "/api/posts", { cookie: user.cookie, body: postInput({ roundId: uuidv7() }) });
    expect(res.status).toBe(422);
    expect(res.json.error.fields.roundId).toBeDefined();
  });
});

describe("list, search, filters, pagination (TSD 7.2)", () => {
  it("treats % and _ in the search term literally", async () => {
    const user = await login(app);
    const marker = `z${Date.now()}`;
    const pct = await createPost(app, user, { title: `${marker} 100% 완료` });
    const und = await createPost(app, user, { title: `${marker} snake_case` });
    await createPost(app, user, { title: `${marker} 100 완료` });
    await createPost(app, user, { title: `${marker} snakeXcase` });

    const byPct = await call(app, "GET", `/api/posts?q=${encodeURIComponent("100%")}`, { cookie: user.cookie });
    expect(byPct.json.items.map((p: { id: string }) => p.id)).toEqual([pct.id]);
    const byUnd = await call(app, "GET", `/api/posts?q=${encodeURIComponent("e_c")}`, { cookie: user.cookie });
    expect(byUnd.json.items.map((p: { id: string }) => p.id)).toEqual([und.id]);
    const byBackslash = await call(app, "GET", `/api/posts?q=${encodeURIComponent("\\%")}`, { cookie: user.cookie });
    expect(byBackslash.json.items).toEqual([]);
  });

  it("searches the body too", async () => {
    const user = await login(app);
    const p = await createPost(app, user, { body: "본문에만 있는 단어 qwertyuiop" });
    const res = await call(app, "GET", "/api/posts?q=qwertyuiop", { cookie: user.cookie });
    expect(res.json.items.map((x: { id: string }) => x.id)).toEqual([p.id]);
  });

  it("limits the search term to 2–50 characters", async () => {
    const user = await login(app);
    expect((await call(app, "GET", "/api/posts?q=a", { cookie: user.cookie })).status).toBe(422);
    expect((await call(app, "GET", `/api/posts?q=${"a".repeat(51)}`, { cookie: user.cookie })).status).toBe(422);
  });

  it("filters by category and tag; the old kind filter is ignored", async () => {
    const user = await login(app);
    const cat = await call(app, "POST", "/api/categories", { cookie: user.cookie, body: { name: `필터${Date.now()}` } });
    const inCat = await createPost(app, user, { categoryId: cat.json.id, tags: ["FilterTag"] });
    await createPost(app, user, { categoryId: cat.json.id });
    await createPost(app, user, { tags: ["filtertag"] });

    const byCat = await call(app, "GET", `/api/posts?category=${cat.json.id}`, { cookie: user.cookie });
    expect(byCat.json.items).toHaveLength(2);
    const byAll = await call(app, "GET", `/api/posts?category=${cat.json.id}&tag=filtertag&kind=question`, {
      cookie: user.cookie,
    });
    expect(byAll.json.items.map((p: { id: string }) => p.id)).toEqual([inCat.id]);
    expect(byAll.json.items[0]).toMatchObject({ tags: ["FilterTag"], commentCount: 0 });
    expect(byAll.json.items[0]).not.toHaveProperty("kind");
  });

  it("paginates newest first, 20 per page, with a (created_at, id) cursor", async () => {
    const user = await login(app);
    const cat = await call(app, "POST", "/api/categories", { cookie: user.cookie, body: { name: `페이지${Date.now()}` } });
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) ids.push((await createPost(app, user, { categoryId: cat.json.id })).id);
    const page1 = await call(app, "GET", `/api/posts?category=${cat.json.id}`, { cookie: user.cookie });
    expect(page1.json.items).toHaveLength(20);
    expect(page1.json.nextCursor).toEqual(expect.any(String));
    const page2 = await call(app, "GET", `/api/posts?category=${cat.json.id}&cursor=${page1.json.nextCursor}`, {
      cookie: user.cookie,
    });
    expect(page2.json.items).toHaveLength(5);
    expect(page2.json.nextCursor).toBeNull();
    const items = [...page1.json.items, ...page2.json.items] as { id: string; createdAt: number }[];
    expect(new Set(items.map((p) => p.id))).toEqual(new Set(ids));
    const sorted = [...items].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
    expect(items).toEqual(sorted);
  });

  it("rejects a malformed cursor", async () => {
    const user = await login(app);
    expect((await call(app, "GET", "/api/posts?cursor=%%%", { cookie: user.cookie })).status).toBe(422);
  });
});

describe("comments", () => {
  it("only the author edits/deletes a comment", async () => {
    const author = await login(app);
    const other = await login(app);
    const post = await createPost(app, other);
    const c = await call(app, "POST", `/api/posts/${post.id}/comments`, { cookie: author.cookie, body: { id: uuidv7(), body: "원문" } });
    expect(c.status).toBe(201);
    expect((await call(app, "PATCH", `/api/comments/${c.json.id}`, { cookie: other.cookie, body: { body: "x" } })).status).toBe(403);
    expect((await call(app, "DELETE", `/api/comments/${c.json.id}`, { cookie: other.cookie })).status).toBe(403);
    const edit = await call(app, "PATCH", `/api/comments/${c.json.id}`, { cookie: author.cookie, body: { body: "수정" } });
    expect(edit.status).toBe(200);
    expect(edit.json.body).toBe("수정");
    expect((await call(app, "DELETE", `/api/comments/${c.json.id}`, { cookie: author.cookie })).status).toBe(204);
    const detail = await call(app, "GET", `/api/posts/${post.id}`, { cookie: other.cookie });
    expect(detail.json.comments).toEqual([]);
  });

  it("validates the comment body", async () => {
    const user = await login(app);
    const post = await createPost(app, user);
    const res = await call(app, "POST", `/api/posts/${post.id}/comments`, {
      cookie: user.cookie,
      body: { id: uuidv7(), body: "x".repeat(5001) },
    });
    expect(res.status).toBe(422);
    expect(res.json.error.fields.body).toBeDefined();
  });

  it("commenting on an unknown post → 404", async () => {
    const user = await login(app);
    const res = await call(app, "POST", `/api/posts/${uuidv7()}/comments`, { cookie: user.cookie, body: { id: uuidv7(), body: "x" } });
    expect(res.status).toBe(404);
  });
});

describe("hidden content (TD-17)", () => {
  it("only admins hide/unhide", async () => {
    const user = await login(app);
    const post = await createPost(app, user);
    expect((await call(app, "POST", `/api/posts/${post.id}/hide`, { cookie: user.cookie })).status).toBe(403);
  });

  it("a hidden post is visible (flagged) to admin and author, 404/excluded for others", async () => {
    const author = await login(app);
    const other = await login(app);
    const admin = await login(app, { isAdmin: true });
    const marker = `hid${Date.now()}`;
    const post = await createPost(app, author, { title: `${marker} 숨김 대상` });

    expect((await call(app, "POST", `/api/posts/${post.id}/hide`, { cookie: admin.cookie })).status).toBe(204);

    for (const u of [author, admin]) {
      const d = await call(app, "GET", `/api/posts/${post.id}`, { cookie: u.cookie });
      expect(d.status).toBe(200);
      expect(d.json.hidden).toBe(true);
      const l = await call(app, "GET", `/api/posts?q=${marker}`, { cookie: u.cookie });
      expect(l.json.items).toEqual([expect.objectContaining({ id: post.id, hidden: true })]);
    }

    expect((await call(app, "GET", `/api/posts/${post.id}`, { cookie: other.cookie })).status).toBe(404);
    expect((await call(app, "GET", `/api/posts?q=${marker}`, { cookie: other.cookie })).json.items).toEqual([]);
    const home = await call(app, "GET", "/api/home", { cookie: other.cookie });
    expect(home.json.recentPosts.map((p: { id: string }) => p.id)).not.toContain(post.id);
    expect(
      (await call(app, "POST", `/api/posts/${post.id}/comments`, { cookie: other.cookie, body: { id: uuidv7(), body: "x" } }))
        .status,
    ).toBe(404);

    // The author can still edit it (TD-17).
    const edit = await call(app, "PATCH", `/api/posts/${post.id}`, { cookie: author.cookie, body: { title: `${marker} 수정` } });
    expect(edit.status).toBe(200);

    expect((await call(app, "POST", `/api/posts/${post.id}/unhide`, { cookie: admin.cookie })).status).toBe(204);
    const back = await call(app, "GET", `/api/posts/${post.id}`, { cookie: other.cookie });
    expect(back.status).toBe(200);
    expect(back.json.hidden).toBe(false);
  });

  it("a hidden comment is shown only to admin and its author", async () => {
    const postAuthor = await login(app);
    const commenter = await login(app);
    const admin = await login(app, { isAdmin: true });
    const post = await createPost(app, postAuthor);
    const c = await call(app, "POST", `/api/posts/${post.id}/comments`, { cookie: commenter.cookie, body: { id: uuidv7(), body: "문제 댓글" } });
    expect((await call(app, "POST", `/api/comments/${c.json.id}/hide`, { cookie: postAuthor.cookie })).status).toBe(403);
    expect((await call(app, "POST", `/api/comments/${c.json.id}/hide`, { cookie: admin.cookie })).status).toBe(204);

    const asPostAuthor = await call(app, "GET", `/api/posts/${post.id}`, { cookie: postAuthor.cookie });
    expect(asPostAuthor.json.comments).toEqual([]);
    for (const u of [commenter, admin]) {
      const d = await call(app, "GET", `/api/posts/${post.id}`, { cookie: u.cookie });
      expect(d.json.comments).toEqual([expect.objectContaining({ id: c.json.id, hidden: true })]);
    }
    // Others can't touch it; the author still can.
    expect((await call(app, "PATCH", `/api/comments/${c.json.id}`, { cookie: postAuthor.cookie, body: { body: "x" } })).status).toBe(404);
    expect((await call(app, "DELETE", `/api/comments/${c.json.id}`, { cookie: commenter.cookie })).status).toBe(204);
  });

  it("hide of an unknown id → 404", async () => {
    const admin = await login(app, { isAdmin: true });
    expect((await call(app, "POST", `/api/posts/${uuidv7()}/hide`, { cookie: admin.cookie })).status).toBe(404);
    expect((await call(app, "POST", `/api/comments/${uuidv7()}/hide`, { cookie: admin.cookie })).status).toBe(404);
  });
});

describe("home", () => {
  it("returns recent posts and this week's meetings; no question list (D-22) or currentRounds", async () => {
    const user = await login(app);
    const post = await createPost(app, user, { title: "최근 글" });
    const res = await call(app, "GET", "/api/home", { cookie: user.cookie });
    expect(res.status).toBe(200);
    expect(res.json.nextMeetings).toEqual([]);
    expect(res.json).not.toHaveProperty("currentRounds");
    expect(res.json).not.toHaveProperty("openQuestions");
    expect(res.json.recentPosts.map((p: { id: string }) => p.id)).toContain(post.id);
    expect(res.json.recentPosts.length).toBeLessThanOrEqual(10);
  });
});
