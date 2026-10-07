// Attached HTML (D-30, D-31, TD-25, TD-26): raw upload/replace/delete by the
// author, pieces across D1 rows for files up to 10 MB, metadata on lists and
// details, signed view URLs for allowed viewers.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { LIMITS } from "../../src/shared/constants";
import { handleHtmlRequest } from "../../src/html-worker/index";
import { buildHtmlUrl } from "../../src/worker/lib/htmlSigning";
import { HTML_CHUNK_BYTES } from "../../src/worker/lib/postHtml";
import { call, createPost, createPostWithHtml, login, makeApp, postInput, putHtml, uuidv7 } from "../helpers";

const app = makeApp();
const HTML = "<!doctype html><html><head><title>정리</title></head><body><h1>트랜잭션</h1></body></html>";
const TOO_LARGE = "파일은 10MB 이하만 올릴 수 있습니다";
const enc = new TextEncoder();

async function htmlRow(postId: string) {
  return env.DB.prepare("SELECT * FROM post_html WHERE post_id = ?").bind(postId).first<Record<string, unknown>>();
}

async function chunkRows(postId: string) {
  return (
    await env.DB.prepare("SELECT seq, length(CAST(data AS BLOB)) AS bytes FROM post_html_chunks WHERE post_id = ? ORDER BY seq")
      .bind(postId)
      .all<{ seq: number; bytes: number }>()
  ).results;
}

/** Exactly `n` UTF-8 bytes of Hangul, emoji, markup and newlines, so piece cuts land inside multi-byte characters. */
function mixedBytes(n: number): Uint8Array {
  const unit = enc.encode("<p>가나다 😀 abc</p>\n");
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += unit.length) out.set(unit.subarray(0, Math.min(unit.length, n - i)), i);
  // The tail may end inside a character: replace that partial character with ASCII.
  let start = n - 1;
  while (start > 0 && ((out[start] ?? 0) & 0xc0) === 0x80) start--;
  const lead = out[start] ?? 0;
  const len = lead < 0x80 ? 1 : lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : 2;
  if (start + len > n) out.fill(0x61, start);
  return out;
}

async function sha256(bytes: ArrayBuffer | Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function serve(postId: string) {
  const url = await buildHtmlUrl(env.HTML_ORIGIN, env.HTML_SIGNING_KEY, postId, Math.floor(Date.now() / 1000) + 3600);
  return handleHtmlRequest(new Request(url), { DB: env.DB, HTML_SIGNING_KEY: env.HTML_SIGNING_KEY });
}

describe("PUT /api/posts/:id/html (raw file body)", () => {
  it("the author attaches, replaces and removes the file; details and lists show metadata only", async () => {
    let now = 1_800_000_000_000;
    const timedApp = makeApp({ now: () => now });
    const author = await login(timedApp);
    const post = await createPost(timedApp, author);
    expect(post.html).toBeNull();

    now += 1000;
    const res = await putHtml(timedApp, author.cookie, post.id, HTML, "정리 노트.html");
    expect(res.status).toBe(200);
    const size = enc.encode(HTML).length;
    expect(res.json.html).toEqual({ filename: "정리 노트.html", size, uploadedAt: now });
    expect(res.json.updatedAt).toBe(now);
    expect(res.json).not.toHaveProperty("html.html");
    expect(await htmlRow(post.id)).toMatchObject({ html: HTML, size, chunk_count: 0, uploaded_via: "site", discord_message_id: null });

    const list = await call(timedApp, "GET", "/api/posts", { cookie: author.cookie });
    const item = list.json.items.find((p: { id: string }) => p.id === post.id);
    expect(item.html).toEqual({ filename: "정리 노트.html", size, uploadedAt: now });
    expect(JSON.stringify(list.json)).not.toContain("트랜잭션");

    // Replace
    now += 1000;
    const replaced = await putHtml(timedApp, author.cookie, post.id, "<p>둘째</p>", "v2.HTM");
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
      expect((await putHtml(app, u.cookie, post.id, HTML)).status).toBe(403);
    }
    await putHtml(app, author.cookie, post.id, HTML);
    for (const u of [other, admin]) {
      expect((await call(app, "DELETE", `/api/posts/${post.id}/html`, { cookie: u.cookie })).status).toBe(403);
    }
    expect((await putHtml(app, undefined, post.id, HTML)).status).toBe(401);
    expect((await htmlRow(post.id))?.html).toBe(HTML);
  });

  it("CSRF: needs Origin and Content-Type text/html (JSON, forms and a missing type are refused)", async () => {
    const author = await login(app);
    const post = await createPost(app, author);
    const put = (opts: Parameters<typeof putHtml>[5]) => putHtml(app, author.cookie, post.id, HTML, "a.html", opts);
    expect((await put({ origin: "https://evil.test" })).status).toBe(403);
    expect((await put({ origin: null })).status).toBe(403);
    for (const contentType of ["application/json", "multipart/form-data", "text/plain", "application/x-www-form-urlencoded", null]) {
      const res = await put({ contentType });
      expect(res.status, String(contentType)).toBe(403);
      expect(res.json.error.code).toBe("FORBIDDEN");
    }
    // The old JSON body is refused too.
    const json = await call(app, "PUT", `/api/posts/${post.id}/html`, { cookie: author.cookie, body: { filename: "a.html", html: HTML } });
    expect(json.status).toBe(403);
    expect(await htmlRow(post.id)).toBeNull();
    // text/html is accepted only on this route.
    const other = await call(app, "PATCH", `/api/posts/${post.id}`, { cookie: author.cookie, contentType: "text/html", body: { title: "x" } });
    expect(other.status).toBe(403);
    expect((await put({ contentType: "text/html" })).status).toBe(200);
  });

  it("unknown post → 404; a hidden post is 404 for others but the author can still attach", async () => {
    const author = await login(app);
    const admin = await login(app, { isAdmin: true });
    const other = await login(app);
    expect((await putHtml(app, author.cookie, uuidv7(), HTML)).status).toBe(404);
    const post = await createPost(app, author);
    expect((await call(app, "POST", `/api/posts/${post.id}/hide`, { cookie: admin.cookie })).status).toBe(204);
    expect((await putHtml(app, other.cookie, post.id, HTML)).status).toBe(404);
    expect((await putHtml(app, author.cookie, post.id, HTML)).status).toBe(200);
  });

  it("validation: file name header, charset, empty, NUL, invalid UTF-8", async () => {
    const author = await login(app);
    const post = await createPost(app, author);
    const bad = (res: Awaited<ReturnType<typeof putHtml>>, field: string, label: string) => {
      expect(res.status, label).toBe(422);
      expect(res.json.error.code).toBe("VALIDATION");
      expect(Object.keys(res.json.error.fields), label).toEqual([field]);
    };
    for (const name of ["a.txt", "a.html.exe", ".html", "../a.html", "a\u0000.html", "", "a".repeat(LIMITS.htmlFilenameMax) + ".html"]) {
      bad(await putHtml(app, author.cookie, post.id, HTML, name), "filename", name);
    }
    bad(await putHtml(app, author.cookie, post.id, HTML, "a.html", { headers: { "X-Filename": "%E0%A4%A.html" } }), "filename", "bad percent");
    bad(
      await call(app, "PUT", `/api/posts/${post.id}/html`, { cookie: author.cookie, contentType: "text/html", rawBody: HTML }),
      "filename",
      "missing header",
    );
    bad(await putHtml(app, author.cookie, post.id, HTML, "a.html", { contentType: "text/html; charset=euc-kr" }), "html", "charset");
    bad(await putHtml(app, author.cookie, post.id, "", "a.html"), "html", "empty");
    bad(await putHtml(app, author.cookie, post.id, "PK\u0003\u0004\u0000\u0000binary", "a.html"), "html", "NUL");
    // "한글" in EUC-KR, and a CESU-style encoded surrogate: not UTF-8.
    bad(await putHtml(app, author.cookie, post.id, new Uint8Array([0x3c, 0x70, 0x3e, 0xc7, 0xd1, 0xb1, 0xdb])), "html", "euc-kr");
    bad(await putHtml(app, author.cookie, post.id, new Uint8Array([0x61, 0xed, 0xa0, 0x80])), "html", "surrogate");
    expect(await htmlRow(post.id)).toBeNull();

    // A percent-encoded Korean name and charset variants are fine.
    expect((await putHtml(app, author.cookie, post.id, HTML, "리액트 훅.HTML", { contentType: 'text/html; charset="UTF-8"' })).status).toBe(200);
    expect((await htmlRow(post.id))?.filename).toBe("리액트 훅.HTML");
  });

  it("over 10,000,000 bytes → 413, by Content-Length before reading and by the bytes actually sent", async () => {
    const author = await login(app);
    const other = await login(app);
    const post = await createPost(app, author);
    const tooLarge = (res: Awaited<ReturnType<typeof putHtml>>) => {
      expect(res.status).toBe(413);
      expect(res.json.error).toEqual({ code: "VALIDATION", message: TOO_LARGE, fields: { html: [TOO_LARGE] } });
    };
    // Declared too large: refused even though the body is tiny, before the post is even looked up.
    const declared = { headers: { "Content-Length": String(LIMITS.htmlMaxBytes + 1) } };
    tooLarge(await putHtml(app, author.cookie, post.id, "<p>x</p>", "a.html", declared));
    tooLarge(await putHtml(app, other.cookie, uuidv7(), "<p>x</p>", "a.html", declared));
    // Actually too large, sent without a length (streamed).
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        const n = Math.min(2_000_000, LIMITS.htmlMaxBytes + 1 - sent);
        if (n <= 0) return c.close();
        sent += n;
        c.enqueue(new Uint8Array(n).fill(0x61));
      },
    });
    tooLarge(await putHtml(app, author.cookie, post.id, stream as unknown as Uint8Array));
    // One byte over, with a correct length; multi-byte characters count as bytes.
    tooLarge(await putHtml(app, author.cookie, post.id, mixedBytes(LIMITS.htmlMaxBytes + 1)));
    tooLarge(await putHtml(app, author.cookie, post.id, "한".repeat(Math.floor(LIMITS.htmlMaxBytes / 3) + 1)));
    expect(await htmlRow(post.id)).toBeNull();
    // A non-author with a valid size still gets 403, not a size error.
    expect((await putHtml(app, other.cookie, post.id, "<p>x</p>")).status).toBe(403);
  });

  it("round trip is byte-exact around the piece size, at 3.8 MB and at exactly 10,000,000 bytes", async () => {
    const author = await login(app);
    const post = await createPost(app, author);
    const sizes = [
      HTML_CHUNK_BYTES - 1,
      HTML_CHUNK_BYTES,
      HTML_CHUNK_BYTES + 1,
      2 * HTML_CHUNK_BYTES - 1,
      2 * HTML_CHUNK_BYTES + 1,
      LIMITS.htmlMaxBytes,
    ];
    for (const n of sizes) {
      const bytes = mixedBytes(n);
      // Prefix a BOM (kept as uploaded) to the largest one.
      if (n === LIMITS.htmlMaxBytes) bytes.set([0xef, 0xbb, 0xbf], 0);
      const res = await putHtml(app, author.cookie, post.id, bytes, `f${n}.html`);
      expect(res.status, String(n)).toBe(200);
      expect(res.json.html.size).toBe(n);

      const row = await htmlRow(post.id);
      const chunks = await chunkRows(post.id);
      expect(row?.chunk_count).toBe(chunks.length);
      expect(chunks.map((c) => c.seq)).toEqual(chunks.map((_, i) => i + 1));
      // Cuts move back to a character start, so a file just under a multiple can take one extra piece.
      expect(chunks.length + 1).toBeGreaterThanOrEqual(Math.ceil(n / HTML_CHUNK_BYTES));
      expect(chunks.length + 1).toBeLessThanOrEqual(Math.ceil(n / HTML_CHUNK_BYTES) + 1);
      const pieceBytes = [enc.encode(row?.html as string).length, ...chunks.map((c) => c.bytes)];
      for (const b of pieceBytes) expect(b).toBeLessThanOrEqual(HTML_CHUNK_BYTES);
      expect(pieceBytes.reduce((a, b) => a + b, 0)).toBe(n);

      const served = await serve(post.id);
      expect(served.status).toBe(200);
      expect(served.headers.get("Content-Length")).toBe(String(n));
      const body = await served.arrayBuffer();
      expect(body.byteLength).toBe(n);
      expect(await sha256(body), String(n)).toBe(await sha256(bytes));
    }
  });

  it("replacing with a smaller file drops the stale pieces; delete removes them all", async () => {
    const author = await login(app);
    const post = await createPost(app, author);
    expect((await putHtml(app, author.cookie, post.id, mixedBytes(3 * HTML_CHUNK_BYTES + 10))).status).toBe(200);
    expect((await chunkRows(post.id)).map((c) => c.seq)).toEqual([1, 2, 3]);

    const smaller = mixedBytes(HTML_CHUNK_BYTES + 100);
    expect((await putHtml(app, author.cookie, post.id, smaller)).status).toBe(200);
    expect((await chunkRows(post.id)).map((c) => c.seq)).toEqual([1]);
    expect((await htmlRow(post.id))?.chunk_count).toBe(1);
    expect(await sha256(await (await serve(post.id)).arrayBuffer())).toBe(await sha256(smaller));

    expect((await putHtml(app, author.cookie, post.id, HTML)).status).toBe(200);
    expect(await chunkRows(post.id)).toEqual([]);
    expect(await (await serve(post.id)).text()).toBe(HTML);

    expect((await putHtml(app, author.cookie, post.id, mixedBytes(2 * HTML_CHUNK_BYTES + 1))).status).toBe(200);
    expect(await chunkRows(post.id)).toHaveLength(2);
    expect((await call(app, "DELETE", `/api/posts/${post.id}/html`, { cookie: author.cookie })).status).toBe(204);
    expect(await chunkRows(post.id)).toEqual([]);
    expect(await htmlRow(post.id)).toBeNull();
    expect((await serve(post.id)).status).toBe(404);
  });
});

describe("POST /api/posts no longer takes the file", () => {
  it("an html field is refused (422), so an old SPA never silently drops a file", async () => {
    const author = await login(app);
    const input = postInput({ html: { filename: "first.html", html: "<p>1</p>" } });
    const res = await call(app, "POST", "/api/posts", { cookie: author.cookie, body: input });
    expect(res.status).toBe(422);
    expect(res.json.error.fields).toHaveProperty("html");
    expect((await call(app, "GET", `/api/posts/${input.id}`, { cookie: author.cookie })).status).toBe(404);
  });
});

describe("post delete cascades to its HTML", () => {
  it("deleting the post deletes post_html and every piece", async () => {
    const author = await login(app);
    const post = await createPostWithHtml(app, author, mixedBytes(2 * HTML_CHUNK_BYTES + 1));
    expect(await htmlRow(post.id)).not.toBeNull();
    expect(await chunkRows(post.id)).toHaveLength(2);
    expect((await call(app, "DELETE", `/api/posts/${post.id}`, { cookie: author.cookie })).status).toBe(204);
    expect(await htmlRow(post.id)).toBeNull();
    expect(await chunkRows(post.id)).toEqual([]);
  });
});

describe("search does not look into HTML (TSD 3.2)", () => {
  it("q matches title/body only", async () => {
    const author = await login(app);
    const marker = `htmlonly${Date.now()}`;
    await createPostWithHtml(app, author, `<p>${marker}</p>`, "a.html", { title: "평범한 글" });
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
    const post = await createPostWithHtml(timedApp, author, HTML);
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
    const post = await createPostWithHtml(app, author, HTML);
    expect((await call(app, "POST", `/api/posts/${post.id}/hide`, { cookie: admin.cookie })).status).toBe(204);
    expect((await call(app, "GET", `/api/posts/${post.id}/html-url`, { cookie: other.cookie })).status).toBe(404);
    expect((await call(app, "GET", `/api/posts/${post.id}/html-url`, { cookie: author.cookie })).status).toBe(200);
    expect((await call(app, "GET", `/api/posts/${post.id}/html-url`, { cookie: admin.cookie })).status).toBe(200);
  });

  it("a member who left the guild cannot get a URL", async () => {
    const author = await login(app);
    const post = await createPostWithHtml(app, author, HTML);
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
