// The isolated HTML worker jungle5-html (TD-26): signed, expiring URLs; the
// user's HTML goes out with a CSP sandbox and never with cookies.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker, { handleHtmlRequest, type HtmlEnv } from "../../src/html-worker/index";
import { buildHtmlUrl, signHtmlUrl } from "../../src/worker/lib/htmlSigning";
import { HTML_CHUNK_BYTES } from "../../src/worker/lib/postHtml";
import { createPost, createPostWithHtml, login, makeApp, uuidv7 } from "../helpers";

const app = makeApp();
const KEY = env.HTML_SIGNING_KEY;
const ORIGIN = "https://jungle5-html.test";
const htmlEnv: HtmlEnv = { DB: env.DB, HTML_SIGNING_KEY: KEY };
type IncomingRequest = Parameters<typeof worker.fetch>[0];
const nowSec = () => Math.floor(Date.now() / 1000);

async function postWithHtml(html: string | Uint8Array) {
  const user = await login(app);
  const post = await createPostWithHtml(app, user, html);
  return post.id;
}

const EXPECTED_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": "sandbox allow-scripts allow-popups allow-forms allow-modals allow-downloads",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "private, max-age=300",
  "x-robots-tag": "noindex, nofollow",
};

async function fetchWorker(url: string, init?: RequestInit) {
  return worker.fetch(new Request(url, init) as IncomingRequest, htmlEnv);
}

describe("jungle5-html worker", () => {
  it("serves the HTML for a valid signature with the sandbox headers and no cookie", async () => {
    const html = "<!doctype html><title>t</title><script>document.cookie='a=b'</script><p>안녕</p>";
    const id = await postWithHtml(html);
    const res = await fetchWorker(await buildHtmlUrl(ORIGIN, KEY, id, nowSec() + 3600));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(html);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("Content-Security-Policy")).toBe(
      "sandbox allow-scripts allow-popups allow-forms allow-modals allow-downloads",
    );
    expect(res.headers.get("Content-Security-Policy")).not.toContain("allow-same-origin");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=300");
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("streams a multi-piece file as the exact uploaded bytes, with Content-Length and the same headers", async () => {
    // 2 extra pieces; Hangul and emoji everywhere, so the cuts fall inside characters.
    const unit = new TextEncoder().encode("<p>정글 😀</p>\n");
    const n = 2 * HTML_CHUNK_BYTES + 12_345;
    const bytes = new Uint8Array(n).fill(0x61);
    for (let i = 0; i + unit.length <= n; i += unit.length) bytes.set(unit, i);
    const id = await postWithHtml(bytes);
    const chunks = await env.DB.prepare("SELECT count(*) AS n FROM post_html_chunks WHERE post_id = ?").bind(id).first<{ n: number }>();
    expect(chunks?.n).toBe(2);

    const res = await fetchWorker(await buildHtmlUrl(ORIGIN, KEY, id, nowSec() + 3600));
    expect(res.status).toBe(200);
    expect(Object.fromEntries(res.headers)).toEqual({ ...EXPECTED_HEADERS, "content-length": String(n) });
    expect(res.body).toBeInstanceOf(ReadableStream);
    // Read it as a stream: more than one piece arrives.
    const reader = res.body!.getReader();
    const parts: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }
    expect(parts.length).toBeGreaterThanOrEqual(3);
    const got = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
    let o = 0;
    for (const p of parts) {
      got.set(p, o);
      o += p.length;
    }
    expect(got.length).toBe(n);
    expect(got.every((v, i) => v === bytes[i])).toBe(true);
  });

  it("a row written before migration 0004 (one piece, chunk_count 0) is served unchanged", async () => {
    const user = await login(app);
    const post = await createPost(app, user);
    const html = "<!doctype html><title>옛 파일</title><p>그대로</p>";
    await env.DB.prepare(
      "INSERT INTO post_html (post_id, html, filename, size, uploaded_at, uploaded_via) VALUES (?, ?, 'old.html', ?, 1, 'site')",
    )
      .bind(post.id, html, new TextEncoder().encode(html).length)
      .run();
    const res = await fetchWorker(await buildHtmlUrl(ORIGIN, KEY, post.id, nowSec() + 3600));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Length")).toBe(String(new TextEncoder().encode(html).length));
    expect(await res.text()).toBe(html);
  });

  it("missing pieces → 500, never a truncated file", async () => {
    const id = await postWithHtml(new Uint8Array(HTML_CHUNK_BYTES + 10).fill(0x62));
    await env.DB.prepare("DELETE FROM post_html_chunks WHERE post_id = ?").bind(id).run();
    const res = await fetchWorker(await buildHtmlUrl(ORIGIN, KEY, id, nowSec() + 3600));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("bbbb");
  });

  it("an expired link → 410 with a Korean page", async () => {
    const id = await postWithHtml("<p>x</p>");
    const res = await fetchWorker(await buildHtmlUrl(ORIGIN, KEY, id, nowSec() - 1));
    expect(res.status).toBe(410);
    expect(await res.text()).toContain("링크가 만료됐습니다. 정글5에서 다시 열어 주세요");
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("a tampered signature, id or expiry → 403", async () => {
    const id = await postWithHtml("<p>x</p>");
    const other = await postWithHtml("<p>other</p>");
    const exp = nowSec() + 3600;
    const sig = await signHtmlUrl(KEY, id, exp);
    const flipped = (sig[0] === "a" ? "b" : "a") + sig.slice(1);
    for (const url of [
      `${ORIGIN}/v/${id}?exp=${exp}&sig=${flipped}`,
      `${ORIGIN}/v/${other}?exp=${exp}&sig=${sig}`,
      `${ORIGIN}/v/${id}?exp=${exp + 1}&sig=${sig}`,
      `${ORIGIN}/v/${id}?exp=${exp}&sig=`,
      `${ORIGIN}/v/${id}?exp=${exp}&sig=zz`,
      `${ORIGIN}/v/${id}?exp=${exp}`,
    ]) {
      const res = await fetchWorker(url);
      expect(res.status, url).toBe(403);
    }
    // Signed with another key.
    const foreign = await buildHtmlUrl(ORIGIN, "another-key-that-is-long-enough-000000", id, exp);
    expect((await fetchWorker(foreign)).status).toBe(403);
  });

  it("an expired URL with a bad signature is still 403 (signature first)", async () => {
    const id = await postWithHtml("<p>x</p>");
    const res = await fetchWorker(`${ORIGIN}/v/${id}?exp=${nowSec() - 10}&sig=${"0".repeat(64)}`);
    expect(res.status).toBe(403);
  });

  it("unknown post, post without HTML, deleted post, other paths → 404", async () => {
    const exp = nowSec() + 3600;
    expect((await fetchWorker(await buildHtmlUrl(ORIGIN, KEY, uuidv7(), exp))).status).toBe(404);

    const user = await login(app);
    const plain = await createPost(app, user);
    expect((await fetchWorker(await buildHtmlUrl(ORIGIN, KEY, plain.id, exp))).status).toBe(404);

    for (const path of ["/", "/v/", "/v", "/api/posts", `/v/not-a-uuid?exp=${exp}&sig=${"0".repeat(64)}`, "/favicon.ico"]) {
      const res = await fetchWorker(`${ORIGIN}${path}`);
      expect(res.status, path).toBe(404);
      expect(res.headers.get("Set-Cookie")).toBeNull();
    }
  });

  it("non-GET methods → 405 (and never serve the HTML)", async () => {
    const id = await postWithHtml("<p>secret</p>");
    const url = await buildHtmlUrl(ORIGIN, KEY, id, nowSec() + 3600);
    for (const method of ["POST", "PUT", "DELETE", "HEAD", "OPTIONS"]) {
      const res = await fetchWorker(url, { method });
      expect(res.status, method).toBe(405);
      expect(await res.text()).not.toContain("secret");
    }
  });

  it("uses the clock: a link signed for t is valid before t and gone after", async () => {
    const id = await postWithHtml("<p>x</p>");
    const exp = 2_000_000_000;
    const url = await buildHtmlUrl(ORIGIN, KEY, id, exp);
    expect((await handleHtmlRequest(new Request(url), htmlEnv, exp * 1000 - 1)).status).toBe(200);
    expect((await handleHtmlRequest(new Request(url), htmlEnv, exp * 1000)).status).toBe(410);
  });

  it("a missing signing key fails closed (500, no HTML)", async () => {
    const id = await postWithHtml("<p>secret</p>");
    const url = await buildHtmlUrl(ORIGIN, KEY, id, nowSec() + 3600);
    const res = await worker.fetch(new Request(url), { DB: env.DB, HTML_SIGNING_KEY: "" });
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("secret");
  });
});
