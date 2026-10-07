// gzip-stored attached HTML (D-30, TD-25, migration 0005): the SPA gzips the
// file (≤ 50 MB original, ≤ 10 MB compressed) and PUTs it as
// application/gzip with X-Original-Size; the server checks the gzip header and
// trailer, never decompresses, and stores the bytes in post_html_blobs. The
// HTML worker sends them back with Content-Encoding: gzip.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { handleHtmlRequest } from "../../src/html-worker/index";
import { LIMITS } from "../../src/shared/constants";
import { buildHtmlUrl } from "../../src/worker/lib/htmlSigning";
import { HTML_BLOB_BYTES, HTML_CHUNK_BYTES } from "../../src/worker/lib/postHtml";
import {
  call,
  createPost,
  createPostWithGzipHtml,
  gunzip,
  gzip,
  login,
  makeApp,
  putGzipHtml,
  putHtml,
  uuidv7,
} from "../helpers";

const app = makeApp();
const enc = new TextEncoder();
const HTML = "<!doctype html><html><head><title>압축</title></head><body><h1>트랜잭션</h1></body></html>";
const LIMITS_MESSAGE = "원본 50MB, 압축 후 10MB 이하만 올릴 수 있습니다";

const htmlRow = (postId: string) =>
  env.DB.prepare("SELECT * FROM post_html WHERE post_id = ?").bind(postId).first<Record<string, unknown>>();
const chunkSeqs = async (postId: string) =>
  (await env.DB.prepare("SELECT seq FROM post_html_chunks WHERE post_id = ? ORDER BY seq").bind(postId).all<{ seq: number }>()).results.map(
    (r) => r.seq,
  );
const blobRows = async (postId: string) =>
  (
    await env.DB.prepare("SELECT seq, length(data) AS bytes, typeof(data) AS type, hex(data) AS hex FROM post_html_blobs WHERE post_id = ? ORDER BY seq")
      .bind(postId)
      .all<{ seq: number; bytes: number; type: string; hex: string }>()
  ).results;

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();

async function sha256(bytes: ArrayBuffer | Uint8Array) {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

/** `n` pseudo-random bytes (incompressible, so the gzip is about as large). */
function noise(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1_103_515_245) + 12_345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

/**
 * A structurally valid gzip body of exactly `n` bytes declaring `originalSize`
 * in its trailer. The server never decompresses (TSD 3.2), so this is enough
 * to test the limits and the byte-exact storage at 10 MB.
 */
function fakeGzip(n: number, originalSize: number): Uint8Array {
  const out = noise(n, n);
  out.set([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0x00, 0xff], 0);
  new DataView(out.buffer).setUint32(n - 4, originalSize % 2 ** 32, true);
  return out;
}

async function serve(postId: string) {
  const url = await buildHtmlUrl(env.HTML_ORIGIN, env.HTML_SIGNING_KEY, postId, Math.floor(Date.now() / 1000) + 3600);
  return handleHtmlRequest(new Request(url), { DB: env.DB, HTML_SIGNING_KEY: env.HTML_SIGNING_KEY });
}

describe("PUT /api/posts/:id/html with Content-Type: application/gzip", () => {
  it("stores the gzip bytes as blobs (html '' and chunk_count 0); metadata shows the original size and compressed", async () => {
    let now = 1_800_000_000_000;
    const timedApp = makeApp({ now: () => now });
    const author = await login(timedApp);
    const post = await createPost(timedApp, author);
    const original = enc.encode(HTML.repeat(50));
    const gz = await gzip(original);
    expect(gz.byteLength).toBeLessThan(original.byteLength);

    now += 1000;
    const res = await putGzipHtml(timedApp, author.cookie, post.id, gz, original.byteLength, "압축 노트.html");
    expect(res.status).toBe(200);
    expect(res.json.html).toEqual({ filename: "압축 노트.html", size: original.byteLength, uploadedAt: now, compressed: true });
    expect(res.json.updatedAt).toBe(now);
    expect(await htmlRow(post.id)).toMatchObject({
      html: "",
      chunk_count: 0,
      encoding: "gzip",
      size: original.byteLength,
      stored_size: gz.byteLength,
      uploaded_via: "site",
      filename: "압축 노트.html",
    });
    const blobs = await blobRows(post.id);
    expect(blobs.map((b) => [b.seq, b.type, b.bytes])).toEqual([[0, "blob", gz.byteLength]]);
    expect(blobs[0]?.hex).toBe(toHex(gz));
    expect(await chunkSeqs(post.id)).toEqual([]);

    const list = await call(timedApp, "GET", "/api/posts", { cookie: author.cookie });
    const item = list.json.items.find((p: { id: string }) => p.id === post.id);
    expect(item.html).toEqual({ filename: "압축 노트.html", size: original.byteLength, uploadedAt: now, compressed: true });

    // Content-Type parameters are fine.
    expect((await putGzipHtml(app, author.cookie, post.id, gz, original.byteLength, "a.html", { contentType: "Application/GZIP; x=1" })).status).toBe(
      200,
    );
  });

  it("a multi-piece gzip is split at 950,000 bytes and stored byte for byte", async () => {
    const author = await login(app);
    const post = await createPost(app, author);
    const original = noise(2 * HTML_BLOB_BYTES + 54_321, 7);
    const gz = await gzip(original);
    expect(gz.byteLength).toBeGreaterThan(2 * HTML_BLOB_BYTES);
    const res = await putGzipHtml(app, author.cookie, post.id, gz, original.byteLength);
    expect(res.status).toBe(200);
    const blobs = await blobRows(post.id);
    expect(blobs.map((b) => b.seq)).toEqual([0, 1, 2]);
    expect(blobs.map((b) => b.bytes)).toEqual([HTML_BLOB_BYTES, HTML_BLOB_BYTES, gz.byteLength - 2 * HTML_BLOB_BYTES]);
    expect(blobs.map((b) => b.hex).join("")).toBe(toHex(gz));
  });

  it("exactly 10,000,000 compressed bytes for a 50,000,000-byte original: accepted and served byte for byte", async () => {
    const author = await login(app);
    const post = await createPost(app, author);
    const body = fakeGzip(LIMITS.htmlMaxStoredBytes, LIMITS.htmlMaxOriginalBytes);
    const res = await putGzipHtml(app, author.cookie, post.id, body, LIMITS.htmlMaxOriginalBytes);
    expect(res.status).toBe(200);
    expect(res.json.html).toMatchObject({ size: 50_000_000, compressed: true });
    expect(await htmlRow(post.id)).toMatchObject({ size: 50_000_000, stored_size: 10_000_000, encoding: "gzip" });
    expect((await blobRows(post.id)).map((b) => b.bytes)).toEqual([...Array(10).fill(HTML_BLOB_BYTES), 500_000]);

    const served = await serve(post.id);
    expect(served.status).toBe(200);
    expect(served.headers.get("Content-Encoding")).toBe("gzip");
    expect(served.headers.get("Content-Length")).toBe("10000000");
    expect(await sha256(await served.arrayBuffer())).toBe(await sha256(body));
  });

  it("not gzip (bad magic, method, reserved flags, too short) → 422 on html, nothing stored", async () => {
    const author = await login(app);
    const post = await createPost(app, author);
    const gz = await gzip(HTML);
    const n = enc.encode(HTML).byteLength;
    const variants: [string, Uint8Array][] = [
      ["raw html", enc.encode(HTML)],
      ["1f 8c", Uint8Array.from(gz, (b, i) => (i === 1 ? 0x8c : b))],
      ["method 07", Uint8Array.from(gz, (b, i) => (i === 2 ? 0x07 : b))],
      ["reserved flag", Uint8Array.from(gz, (b, i) => (i === 3 ? 0x20 : b))],
      ["zip", new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...gz.subarray(4)])],
      ["too short", gz.subarray(0, 19)],
    ];
    for (const [label, body] of variants) {
      const res = await putGzipHtml(app, author.cookie, post.id, body, n);
      expect(res.status, label).toBe(422);
      expect(res.json.error.code).toBe("VALIDATION");
      expect(res.json.error.fields, label).toEqual({ html: ["gzip으로 압축한 파일이 아닙니다"] });
    }
    const empty = await putGzipHtml(app, author.cookie, post.id, new Uint8Array(0), n);
    expect(empty.status).toBe(422);
    expect(empty.json.error.fields).toEqual({ html: ["빈 파일입니다"] });
    expect(await htmlRow(post.id)).toBeNull();
    expect(await blobRows(post.id)).toEqual([]);
  });

  it("compressed over 10,000,000 bytes → 413, by Content-Length before reading and by the bytes actually sent", async () => {
    const author = await login(app);
    const other = await login(app);
    const post = await createPost(app, author);
    const tooLarge = (res: Awaited<ReturnType<typeof putGzipHtml>>, label: string) => {
      expect(res.status, label).toBe(413);
      expect(res.json.error, label).toEqual({ code: "VALIDATION", message: LIMITS_MESSAGE, fields: { html: [LIMITS_MESSAGE] } });
    };
    const gz = await gzip(HTML);
    const declared = { headers: { "Content-Length": String(LIMITS.htmlMaxStoredBytes + 1) } };
    tooLarge(await putGzipHtml(app, author.cookie, post.id, gz, 100, "a.html", declared), "declared");
    // Before the post is even looked up.
    tooLarge(await putGzipHtml(app, other.cookie, uuidv7(), gz, 100, "a.html", declared), "declared, unknown post");
    // Streamed without a length.
    let sent = 0;
    const header = fakeGzip(20, 1);
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        const n = Math.min(2_000_000, LIMITS.htmlMaxStoredBytes + 1 - sent);
        if (n <= 0) return c.close();
        const chunk = new Uint8Array(n).fill(0x61);
        if (sent === 0) chunk.set(header.subarray(0, 10));
        sent += n;
        c.enqueue(chunk);
      },
    });
    tooLarge(await putGzipHtml(app, author.cookie, post.id, stream, 40_000_000), "streamed");
    // One byte over, with a correct length and a valid header and trailer.
    tooLarge(await putGzipHtml(app, author.cookie, post.id, fakeGzip(LIMITS.htmlMaxStoredBytes + 1, 40_000_000), 40_000_000), "one over");
    expect(await htmlRow(post.id)).toBeNull();
    // A non-author with a valid size still gets 403, not a size error.
    expect((await putGzipHtml(app, other.cookie, post.id, gz, enc.encode(HTML).byteLength)).status).toBe(403);
  });

  it("X-Original-Size missing, malformed, 0 or over 50,000,000, or unlike the gzip trailer → 422 on html", async () => {
    const author = await login(app);
    const post = await createPost(app, author);
    const gz = await gzip(HTML);
    const n = enc.encode(HTML).byteLength;
    const bad = async (size: number | string | null, label: string, message: string) => {
      const res = await putGzipHtml(app, author.cookie, post.id, gz, size);
      expect(res.status, label).toBe(422);
      expect(res.json.error.code).toBe("VALIDATION");
      expect(res.json.error.fields, label).toEqual({ html: [message] });
    };
    const required = "원본 크기(X-Original-Size)가 필요합니다";
    await bad(null, "missing", required);
    for (const v of ["", "abc", "1.5", "-1", "1e6", "0x10", "12 34", "1234567890"]) await bad(v, JSON.stringify(v), required);
    await bad(0, "zero", "빈 파일입니다");
    await bad(LIMITS.htmlMaxOriginalBytes + 1, "over 50 MB", LIMITS_MESSAGE);
    await bad(n + 1, "trailer mismatch", "압축한 파일과 원본 크기가 맞지 않습니다");
    expect(await htmlRow(post.id)).toBeNull();
    // Surrounding spaces are tolerated.
    expect((await putGzipHtml(app, author.cookie, post.id, gz, ` ${n} `)).status).toBe(200);
  });

  it("filename is still checked (422 on filename)", async () => {
    const author = await login(app);
    const post = await createPost(app, author);
    const gz = await gzip(HTML);
    const res = await putGzipHtml(app, author.cookie, post.id, gz, enc.encode(HTML).byteLength, "a.txt");
    expect(res.status).toBe(422);
    expect(Object.keys(res.json.error.fields)).toEqual(["filename"]);
  });

  it("only the author (403 for other members and admins; 401 without login; 404 unknown post)", async () => {
    const author = await login(app);
    const other = await login(app);
    const admin = await login(app, { isAdmin: true });
    const post = await createPost(app, author);
    const gz = await gzip(HTML);
    const n = enc.encode(HTML).byteLength;
    for (const u of [other, admin]) expect((await putGzipHtml(app, u.cookie, post.id, gz, n)).status).toBe(403);
    expect((await putGzipHtml(app, undefined, post.id, gz, n)).status).toBe(401);
    expect((await putGzipHtml(app, author.cookie, uuidv7(), gz, n)).status).toBe(404);
    expect(await htmlRow(post.id)).toBeNull();
  });

  it("CSRF: Origin is still required; application/gzip only on this route; x-gzip and octet-stream are refused", async () => {
    const author = await login(app);
    const post = await createPost(app, author);
    const gz = await gzip(HTML);
    const n = enc.encode(HTML).byteLength;
    expect((await putGzipHtml(app, author.cookie, post.id, gz, n, "a.html", { origin: "https://evil.test" })).status).toBe(403);
    expect((await putGzipHtml(app, author.cookie, post.id, gz, n, "a.html", { origin: null })).status).toBe(403);
    for (const contentType of ["application/x-gzip", "application/octet-stream", "text/plain"]) {
      const res = await putGzipHtml(app, author.cookie, post.id, gz, n, "a.html", { contentType });
      expect(res.status, contentType).toBe(403);
      expect(res.json.error.code).toBe("FORBIDDEN");
    }
    const patch = await call(app, "PATCH", `/api/posts/${post.id}`, { cookie: author.cookie, contentType: "application/gzip", body: { title: "x" } });
    expect(patch.status).toBe(403);
    expect(await htmlRow(post.id)).toBeNull();
  });
});

describe("replacing between identity and gzip, deleting", () => {
  it("each replacement leaves only the new representation's rows", async () => {
    const author = await login(app);
    const post = await createPost(app, author);
    const bigText = new Uint8Array(2 * HTML_CHUNK_BYTES + 10).fill(0x61);

    // identity (3 pieces) → gzip: the chunks go, html is emptied.
    expect((await putHtml(app, author.cookie, post.id, bigText)).status).toBe(200);
    expect(await chunkSeqs(post.id)).toEqual([1, 2]);
    const noisy = noise(HTML_BLOB_BYTES + 5, 3);
    const gzNoisy = await gzip(noisy);
    expect((await putGzipHtml(app, author.cookie, post.id, gzNoisy, noisy.byteLength)).status).toBe(200);
    expect(await chunkSeqs(post.id)).toEqual([]);
    expect((await blobRows(post.id)).map((b) => b.seq)).toEqual([0, 1]);
    expect(await htmlRow(post.id)).toMatchObject({ html: "", chunk_count: 0, encoding: "gzip", stored_size: gzNoisy.byteLength });

    // gzip (2 pieces) → smaller gzip: one piece left.
    const gz = await gzip(HTML);
    expect((await putGzipHtml(app, author.cookie, post.id, gz, enc.encode(HTML).byteLength)).status).toBe(200);
    expect((await blobRows(post.id)).map((b) => [b.seq, b.hex])).toEqual([[0, toHex(gz)]]);

    // gzip → identity: the blobs go.
    const replaced = await putHtml(app, author.cookie, post.id, HTML);
    expect(replaced.status).toBe(200);
    expect(replaced.json.html).toMatchObject({ compressed: false, size: enc.encode(HTML).byteLength });
    expect(await blobRows(post.id)).toEqual([]);
    expect(await htmlRow(post.id)).toMatchObject({ html: HTML, encoding: "identity", stored_size: enc.encode(HTML).byteLength });
    expect(await (await serve(post.id)).text()).toBe(HTML);
    expect((await serve(post.id)).headers.get("Content-Encoding")).toBeNull();
  });

  it("a failing replacement changes nothing (one batch)", async () => {
    const author = await login(app);
    const post = await createPost(app, author);
    const bigText = new Uint8Array(HTML_CHUNK_BYTES + 10).fill(0x62);
    expect((await putHtml(app, author.cookie, post.id, bigText)).status).toBe(200);
    const before = await htmlRow(post.id);

    // Make the second blob insert fail: the whole batch, including the deletes, must roll back.
    await env.DB.prepare(
      "CREATE TRIGGER zz_fail_blob BEFORE INSERT ON post_html_blobs WHEN NEW.seq = 1 BEGIN SELECT RAISE(ABORT, 'boom'); END",
    ).run();
    try {
      const noisy = noise(HTML_BLOB_BYTES + 5, 9);
      const res = await putGzipHtml(app, author.cookie, post.id, await gzip(noisy), noisy.byteLength);
      expect(res.status).toBe(500);
    } finally {
      await env.DB.prepare("DROP TRIGGER zz_fail_blob").run();
    }
    expect(await htmlRow(post.id)).toEqual(before);
    expect(await chunkSeqs(post.id)).toEqual([1]);
    expect(await blobRows(post.id)).toEqual([]);
    expect(await sha256(await (await serve(post.id)).arrayBuffer())).toBe(await sha256(bigText));
  });

  it("DELETE /html removes the blobs; deleting the post cascades to them", async () => {
    const author = await login(app);
    const noisy = noise(HTML_BLOB_BYTES + 5, 5);
    const a = await createPostWithGzipHtml(app, author, noisy);
    expect(await blobRows(a.id)).toHaveLength(2);
    expect((await call(app, "DELETE", `/api/posts/${a.id}/html`, { cookie: author.cookie })).status).toBe(204);
    expect(await blobRows(a.id)).toEqual([]);
    expect(await htmlRow(a.id)).toBeNull();
    expect((await serve(a.id)).status).toBe(404);

    const b = await createPostWithGzipHtml(app, author, noisy);
    expect(await blobRows(b.id)).toHaveLength(2);
    expect((await call(app, "DELETE", `/api/posts/${b.id}`, { cookie: author.cookie })).status).toBe(204);
    expect(await blobRows(b.id)).toEqual([]);
    expect(await htmlRow(b.id)).toBeNull();
  });

  it("html-url and the HTML worker work for a gzip file; the browser sees the original bytes", async () => {
    const author = await login(app);
    const reader = await login(app);
    const original = enc.encode(HTML.repeat(10));
    const post = await createPostWithGzipHtml(app, author, original);
    const res = await call(app, "GET", `/api/posts/${post.id}/html-url`, { cookie: reader.cookie });
    expect(res.status).toBe(200);
    const served = await handleHtmlRequest(new Request(res.json.url), { DB: env.DB, HTML_SIGNING_KEY: env.HTML_SIGNING_KEY });
    expect(served.status).toBe(200);
    expect(served.headers.get("Content-Encoding")).toBe("gzip");
    expect(await gunzip(await served.arrayBuffer())).toEqual(original);
  });
});
