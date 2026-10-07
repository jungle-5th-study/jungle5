// Attached HTML (D-30, D-31, TD-25, TD-26): upload/replace/delete by the
// author, metadata on lists and details, signed view URLs for allowed viewers.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { LIMITS } from "../../src/shared/constants";
import { handleHtmlRequest } from "../../src/html-worker/index";
import { call, createPost, login, makeApp, postInput, uuidv7 } from "../helpers";

const app = makeApp();
const HTML = "<!doctype html><html><head><title>정리</title></head><body><h1>트랜잭션</h1></body></html>";

const putHtml = (cookie: string, id: string, body: unknown) => call(app, "PUT", `/api/posts/${id}/html`, { cookie, body });

async function htmlRow(postId: string) {
  return env.DB.prepare("SELECT * FROM post_html WHERE post_id = ?").bind(postId).first<Record<string, unknown>>();
}

describe("PUT /api/posts/:id/html", () => {
  it("the author attaches, replaces and removes the file; details and lists show metadata only", async () => {
    let now = 1_800_000_000_000;
    const timedApp = makeApp({ now: () => now });
    const author = await login(timedApp);
    const post = await createPost(timedApp, author);
    expect(post.html).toBeNull();

    now += 1000;
    const res = await call(timedApp, "PUT", `/api/posts/${post.id}/html`, {
      cookie: author.cookie,
      body: { filename: "note.html", html: HTML },
    });
    expect(res.status).toBe(200);
    const size = new TextEncoder().encode(HTML).length;
    expect(res.json.html).toEqual({ filename: "note.html", size, uploadedAt: now });
    expect(res.json.updatedAt).toBe(now);
    expect(res.json).not.toHaveProperty("html.html");
    expect(await htmlRow(post.id)).toMatchObject({ html: HTML, size, uploaded_via: "site", discord_message_id: null });

    const list = await call(timedApp, "GET", "/api/posts", { cookie: author.cookie });
    const item = list.json.items.find((p: { id: string }) => p.id === post.id);
    expect(item.html).toEqual({ filename: "note.html", size, uploadedAt: now });
    expect(JSON.stringify(list.json)).not.toContain("트랜잭션");

    // Replace
    now += 1000;
    const replaced = await call(timedApp, "PUT", `/api/posts/${post.id}/html`, {
      cookie: author.cookie,
      body: { filename: "v2.HTM", html: "<p>둘째</p>" },
    });
    expect(replaced.status).toBe(200);
    expect(replaced.json.html).toMatchObject({ filename: "v2.HTM", uploadedAt: now });
    expect((await htmlRow(post.id))?.html).toBe("<p>둘째</p>");
    expect(
      (await env.DB.prepare("SELECT count(*) AS n FROM post_html WHERE post_id = ?").bind(post.id).first<{ n: number }>())?.n,
    ).toBe(1);

    // Delete (idempotent)
    now += 1000;
    const del = await call(timedApp, "DELETE", `/api/posts/${post.id}/html`, { cookie: author.cookie });
    expect(del.status).toBe(204);
    expect(await htmlRow(post.id)).toBeNull();
    const after = await call(timedApp, "GET", `/api/posts/${post.id}`, { cookie: author.cookie });
    expect(after.json.html).toBeNull();
    expect(after.json.updatedAt).toBe(now);
    now += 1000;
    expect((await call(timedApp, "DELETE", `/api/posts/${post.id}/html`, { cookie: author.cookie })).status).toBe(204);
    expect((await call(timedApp, "GET", `/api/posts/${post.id}`, { cookie: author.cookie })).json.updatedAt).toBe(now - 1000);
  });

  it("only the author (403 for other members and admins; 401 without login)", async () => {
    const author = await login(app);
    const other = await login(app);
    const admin = await login(app, { isAdmin: true });
    const post = await createPost(app, author);
    for (const u of [other, admin]) {
      expect((await putHtml(u.cookie, post.id, { filename: "a.html", html: HTML })).status).toBe(403);
    }
    await putHtml(author.cookie, post.id, { filename: "a.html", html: HTML });
    for (const u of [other, admin]) {
      expect((await call(app, "DELETE", `/api/posts/${post.id}/html`, { cookie: u.cookie })).status).toBe(403);
    }
    expect((await call(app, "PUT", `/api/posts/${post.id}/html`, { body: { filename: "a.html", html: HTML } })).status).toBe(401);
    expect((await htmlRow(post.id))?.html).toBe(HTML);
  });

  it("CSRF: needs Origin and application/json", async () => {
    const author = await login(app);
    const post = await createPost(app, author);
    const body = { filename: "a.html", html: HTML };
    expect((await call(app, "PUT", `/api/posts/${post.id}/html`, { cookie: author.cookie, body, origin: "https://evil.test" })).status).toBe(403);
    expect(
      (await call(app, "PUT", `/api/posts/${post.id}/html`, { cookie: author.cookie, body, contentType: "multipart/form-data" })).status,
    ).toBe(403);
  });

  it("unknown post → 404; a hidden post is 404 for others but the author can still attach", async () => {
    const author = await login(app);
    const admin = await login(app, { isAdmin: true });
    const other = await login(app);
    expect((await putHtml(author.cookie, uuidv7(), { filename: "a.html", html: HTML })).status).toBe(404);
    const post = await createPost(app, author);
    expect((await call(app, "POST", `/api/posts/${post.id}/hide`, { cookie: admin.cookie })).status).toBe(204);
    expect((await putHtml(other.cookie, post.id, { filename: "a.html", html: HTML })).status).toBe(404);
    expect((await putHtml(author.cookie, post.id, { filename: "a.html", html: HTML })).status).toBe(200);
  });

  it("validation: extension, size (UTF-8 bytes), text-only content, filename", async () => {
    const author = await login(app);
    const post = await createPost(app, author);
    const bad = async (body: unknown, field: string) => {
      const res = await putHtml(author.cookie, post.id, body);
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(422);
      expect(res.json.error.code).toBe("VALIDATION");
      expect(Object.keys(res.json.error.fields)).toContain(field);
    };
    await bad({ filename: "a.txt", html: HTML }, "filename");
    await bad({ filename: "a.html.exe", html: HTML }, "filename");
    await bad({ filename: ".html", html: HTML }, "filename");
    await bad({ filename: "../a.html", html: HTML }, "filename");
    await bad({ filename: "a\u0000.html", html: HTML }, "filename");
    await bad({ html: HTML }, "filename");
    await bad({ filename: "a.html" }, "html");
    await bad({ filename: "a.html", html: "" }, "html");
    await bad({ filename: "a.html", html: "PK\u0003\u0004\u0000\u0000binary" }, "html");
    await bad({ filename: "a.html", html: "<p>\uD800</p>" }, "html"); // lone surrogate: not encodable as UTF-8

    // Size counts UTF-8 bytes: 한 = 3 bytes.
    const max = LIMITS.htmlMaxBytes;
    await bad({ filename: "a.html", html: "a".repeat(max + 1) }, "html");
    await bad({ filename: "a.html", html: "한".repeat(Math.floor(max / 3) + 1) }, "html");
    expect((await putHtml(author.cookie, post.id, { filename: "a.html", html: "a".repeat(max) })).status).toBe(200);
    expect((await htmlRow(post.id))?.size).toBe(max);
    expect((await putHtml(author.cookie, post.id, { filename: "A.HTM", html: "한".repeat(Math.floor(max / 3)) })).status).toBe(200);
  });
});

describe("POST /api/posts with html (create + attach in one request)", () => {
  it("attaches on create; an idempotent replay keeps the first file", async () => {
    const author = await login(app);
    const input = postInput({ html: { filename: "first.html", html: "<p>1</p>" } });
    const created = await call(app, "POST", "/api/posts", { cookie: author.cookie, body: input });
    expect(created.status).toBe(201);
    expect(created.json.html).toMatchObject({ filename: "first.html", size: 8 });
    const replay = await call(app, "POST", "/api/posts", {
      cookie: author.cookie,
      body: { ...input, html: { filename: "second.html", html: "<p>2</p>" } },
    });
    expect(replay.status).toBe(200);
    expect(replay.json.html.filename).toBe("first.html");
    expect((await htmlRow(input.id))?.html).toBe("<p>1</p>");
  });

  it("an invalid file rejects the whole create (no post row)", async () => {
    const author = await login(app);
    const input = postInput({ html: { filename: "x.pdf", html: "<p>1</p>" } });
    const res = await call(app, "POST", "/api/posts", { cookie: author.cookie, body: input });
    expect(res.status).toBe(422);
    expect(res.json.error.fields).toHaveProperty("html.filename");
    expect((await call(app, "GET", `/api/posts/${input.id}`, { cookie: author.cookie })).status).toBe(404);
  });
});

describe("post delete cascades to its HTML", () => {
  it("deleting the post deletes post_html", async () => {
    const author = await login(app);
    const post = await createPost(app, author, { html: { filename: "a.html", html: HTML } });
    expect(await htmlRow(post.id)).not.toBeNull();
    expect((await call(app, "DELETE", `/api/posts/${post.id}`, { cookie: author.cookie })).status).toBe(204);
    expect(await htmlRow(post.id)).toBeNull();
  });
});

describe("search does not look into HTML (TSD 3.2)", () => {
  it("q matches title/body only", async () => {
    const author = await login(app);
    const marker = `htmlonly${Date.now()}`;
    await createPost(app, author, { title: "평범한 글", html: { filename: "a.html", html: `<p>${marker}</p>` } });
    const res = await call(app, "GET", `/api/posts?q=${marker}`, { cookie: author.cookie });
    expect(res.status).toBe(200);
    expect(res.json.items).toEqual([]);
    const byTitle = await call(app, "GET", `/api/posts?q=${encodeURIComponent("평범한")}`, { cookie: author.cookie });
    expect(byTitle.json.items.length).toBeGreaterThan(0);
  });
});

describe("GET /api/posts/:id/html-url (TD-26)", () => {
  it("returns a 1-hour signed URL on HTML_ORIGIN that the HTML worker accepts", async () => {
    const now = Date.now();
    const timedApp = makeApp({ now: () => now });
    const author = await login(timedApp);
    const reader = await login(timedApp);
    const post = await createPost(timedApp, author, { html: { filename: "a.html", html: HTML } });
    const res = await call(timedApp, "GET", `/api/posts/${post.id}/html-url`, { cookie: reader.cookie });
    expect(res.status).toBe(200);
    expect(Object.keys(res.json).sort()).toEqual(["expiresAt", "url"]);
    const exp = Math.floor(now / 1000) + 3600;
    expect(res.json.expiresAt).toBe(exp * 1000);
    expect(res.json.url).toMatch(new RegExp(`^https://jungle5-html\\.test/v/${post.id}\\?exp=${exp}&sig=[0-9a-f]{64}$`));
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const served = await handleHtmlRequest(new Request(res.json.url), { DB: env.DB, HTML_SIGNING_KEY: env.HTML_SIGNING_KEY }, now);
    expect(served.status).toBe(200);
    expect(await served.text()).toBe(HTML);
  });

  it("404 when the post has no HTML or does not exist; 401 without login", async () => {
    const author = await login(app);
    const post = await createPost(app, author);
    expect((await call(app, "GET", `/api/posts/${post.id}/html-url`, { cookie: author.cookie })).status).toBe(404);
    expect((await call(app, "GET", `/api/posts/${uuidv7()}/html-url`, { cookie: author.cookie })).status).toBe(404);
    expect((await call(app, "GET", `/api/posts/${post.id}/html-url`)).status).toBe(401);
  });

  it("hidden post (TD-17): author and admins get a URL, other members get 404", async () => {
    const author = await login(app);
    const admin = await login(app, { isAdmin: true });
    const other = await login(app);
    const post = await createPost(app, author, { html: { filename: "a.html", html: HTML } });
    expect((await call(app, "POST", `/api/posts/${post.id}/hide`, { cookie: admin.cookie })).status).toBe(204);
    expect((await call(app, "GET", `/api/posts/${post.id}/html-url`, { cookie: other.cookie })).status).toBe(404);
    expect((await call(app, "GET", `/api/posts/${post.id}/html-url`, { cookie: author.cookie })).status).toBe(200);
    expect((await call(app, "GET", `/api/posts/${post.id}/html-url`, { cookie: admin.cookie })).status).toBe(200);
  });

  it("a member who left the guild cannot get a URL", async () => {
    const author = await login(app);
    const post = await createPost(app, author, { html: { filename: "a.html", html: HTML } });
    const leaver = await login(app);
    await env.DB.prepare("UPDATE members SET is_guild_member = 0 WHERE id = ?").bind(leaver.memberId).run();
    expect((await call(app, "GET", `/api/posts/${post.id}/html-url`, { cookie: leaver.cookie })).status).toBe(401);
  });
});

describe("main CSP (TSD 9.5)", () => {
  it("allows frames only from HTML_ORIGIN and keeps the rest strict", async () => {
    const user = await login(app);
    const res = await call(app, "GET", "/api/me", { cookie: user.cookie });
    expect(res.headers.get("Content-Security-Policy")).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https:; connect-src 'self'; frame-src https://jungle5-html.test; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const unset = await call(app, "GET", "/api/me", { cookie: user.cookie, env: { HTML_ORIGIN: "" } });
    expect(unset.headers.get("Content-Security-Policy")).toContain("frame-src 'none';");
    const spa = await call(app, "GET", "/posts/x");
    expect(spa.headers.get("Content-Security-Policy")).toContain("frame-src https://jungle5-html.test;");
  });
});
