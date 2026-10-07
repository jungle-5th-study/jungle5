// jungle5-html: the isolated origin for user-uploaded HTML (TD-26).
// User HTML runs scripts, so it is never served from jungle5.xyz. This worker
// lives on workers.dev (a public suffix → a different site), answers only
// GET /v/:postId?exp=&sig= with a signature made by the main worker, and never
// sets cookies. It reads the same D1 database (post_html, post_html_chunks) read-only.
import { verifyHtmlSignature } from "../worker/lib/htmlSigning";

export interface HtmlEnv {
  DB: D1Database;
  /** Shared with the main worker (wrangler secret on both). */
  HTML_SIGNING_KEY: string;
}

/** Headers for the user's HTML. `sandbox` without allow-same-origin = opaque origin, even top-level. */
export const HTML_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": "sandbox allow-scripts allow-popups allow-forms allow-modals allow-downloads",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "private, max-age=300",
  "X-Robots-Tag": "noindex, nofollow",
};

/** Our own error pages: no scripts at all. */
const ERROR_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
};

function errorPage(status: number, message: string, extra: Record<string, string> = {}): Response {
  const body = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>정글5</title></head><body style="font-family:system-ui,sans-serif;padding:2rem;line-height:1.6"><p>${message}</p></body></html>`;
  return new Response(body, { status, headers: { ...ERROR_HEADERS, ...extra } });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PATH = /^\/v\/([^/]+)$/;

export async function handleHtmlRequest(request: Request, env: HtmlEnv, nowMs: number = Date.now()): Promise<Response> {
  const url = new URL(request.url);
  const match = PATH.exec(url.pathname);
  if (!match) return errorPage(404, "찾을 수 없습니다");
  if (request.method !== "GET") return errorPage(405, "허용되지 않은 요청입니다", { Allow: "GET" });

  const postId = decodeURIComponent(match[1] ?? "").toLowerCase();
  const expRaw = url.searchParams.get("exp") ?? "";
  const sig = url.searchParams.get("sig") ?? "";
  if (!UUID.test(postId) || !/^\d{1,12}$/.test(expRaw)) return errorPage(404, "찾을 수 없습니다");
  const exp = Number(expRaw);

  // Signature first, so an expired-but-forged URL tells nothing.
  if (!(await verifyHtmlSignature(env.HTML_SIGNING_KEY, postId, exp, sig))) {
    return errorPage(403, "잘못된 링크입니다");
  }
  if (exp * 1000 <= nowMs) return errorPage(410, "링크가 만료됐습니다. 정글5에서 다시 열어 주세요");

  // TD-25: piece 0 is post_html.html, pieces 1..n are post_html_chunks. One
  // batch is one D1 transaction, so both reads see the same upload.
  const [head, rest] = await env.DB.batch([
    env.DB.prepare("SELECT html, size, chunk_count FROM post_html WHERE post_id = ?").bind(postId),
    env.DB.prepare("SELECT data FROM post_html_chunks WHERE post_id = ? ORDER BY seq").bind(postId),
  ]);
  const row = (head?.results as { html: string; size: number; chunk_count: number }[] | undefined)?.[0];
  if (!row) return errorPage(404, "찾을 수 없습니다");
  const chunks = (rest?.results ?? []) as { data: string }[];
  if (chunks.length !== row.chunk_count) throw new Error(`post_html ${postId}: ${chunks.length} of ${row.chunk_count} chunks`);

  return new Response(streamPieces([row.html, ...chunks.map((c) => c.data)], row.size), {
    status: 200,
    headers: { ...HTML_HEADERS, "Content-Length": String(row.size) },
  });
}

/**
 * The file as a stream of its pieces' UTF-8 bytes, one piece per pull, so no
 * 10 MB string or buffer is ever built. FixedLengthStream makes the response
 * carry `Content-Length: size` and fails it if the bytes do not add up.
 */
function streamPieces(pieces: (string | undefined)[], size: number): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  const source = new ReadableStream<Uint8Array>({
    pull(controller) {
      const piece = pieces[i];
      pieces[i++] = undefined; // let the string go once it is encoded
      if (piece !== undefined) controller.enqueue(encoder.encode(piece));
      if (i >= pieces.length) controller.close();
    },
  });
  return source.pipeThrough(new FixedLengthStream(size));
}

export default {
  async fetch(request, env) {
    try {
      return await handleHtmlRequest(request, env);
    } catch (err) {
      console.error(JSON.stringify({ level: "error", error: String(err) }));
      return errorPage(500, "잠시 후 다시 시도하세요");
    }
  },
} satisfies ExportedHandler<HtmlEnv>;
