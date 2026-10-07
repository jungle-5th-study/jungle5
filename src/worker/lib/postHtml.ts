// Storing a post's attached HTML (D-30, TD-25). Used by the posts routes and
// the Discord message command (D-32).
//
// One D1 value holds at most 2,000,000 bytes, so a file of up to 10,000,000
// bytes is cut into pieces of at most HTML_CHUNK_BYTES, each at a UTF-8
// character boundary and stored as TEXT: piece 0 in post_html.html, pieces
// 1..n in post_html_chunks (migration 0004). Every write replaces the whole set
// in one batch, so readers never see a mix of two uploads.
import { eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { LIMITS } from "../../shared/constants";
import { postHtml, postHtmlChunks } from "../db/schema";
import type { Db } from "../types";

/** Largest piece, in UTF-8 bytes: under the 2,000,000-byte D1 value cap with room for post_html's other columns. */
export const HTML_CHUNK_BYTES = 1_900_000;

/**
 * Splits UTF-8 bytes into views of at most `maxBytes`, never inside a
 * multi-byte character: a cut that would land on a continuation byte
 * (0b10xxxxxx) moves back to the start of that character (at most 3 bytes).
 * Invalid UTF-8 may still be cut anywhere; strict decoding rejects it later.
 */
export function splitUtf8(bytes: Uint8Array, maxBytes: number = HTML_CHUNK_BYTES): Uint8Array[] {
  const pieces: Uint8Array[] = [];
  let start = 0;
  while (bytes.length - start > maxBytes) {
    let end = start + maxBytes;
    for (let back = 0; back < 3 && ((bytes[end] ?? 0) & 0xc0) === 0x80; back++) end--;
    pieces.push(bytes.subarray(start, end));
    start = end;
  }
  pieces.push(bytes.subarray(start));
  return pieces;
}

/** A checked file, ready to store: `pieces` are the decoded pieces in order. */
export interface HtmlFile {
  filename: string;
  pieces: string[];
  /** Total UTF-8 bytes. */
  size: number;
}

export type HtmlBytesProblem = "empty" | "too_large" | "not_text";
export type HtmlBytesResult = { ok: true; pieces: string[]; size: number } | { ok: false; problem: HtmlBytesProblem };

/**
 * Checks raw file bytes (≤ 10,000,000, strict UTF-8, no U+0000) and decodes
 * them piece by piece. Decoding each piece with `fatal` validates the whole
 * file, because pieces end at character boundaries. `ignoreBOM` keeps a
 * leading BOM (and any U+FEFF at a cut), so the stored text re-encodes to
 * exactly the uploaded bytes and `size` matches what the HTML worker sends.
 */
export function decodeHtmlBytes(bytes: Uint8Array): HtmlBytesResult {
  if (bytes.byteLength === 0) return { ok: false, problem: "empty" };
  if (bytes.byteLength > LIMITS.htmlMaxBytes) return { ok: false, problem: "too_large" };
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const pieces: string[] = [];
  for (const piece of splitUtf8(bytes)) {
    let text: string;
    try {
      text = decoder.decode(piece);
    } catch {
      return { ok: false, problem: "not_text" };
    }
    // U+0000 means a binary file. Searching the string is several times
    // cheaper than Uint8Array#includes (measured in workerd).
    if (text.includes("\u0000")) return { ok: false, problem: "not_text" };
    pieces.push(text);
  }
  return { ok: true, pieces, size: bytes.byteLength };
}

/**
 * Reads a request/response body, stopping as soon as it passes `maxBytes`
 * (a missing or wrong Content-Length cannot make us buffer more).
 * Returns null when the body is larger than `maxBytes`.
 */
export async function readBodyCapped(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    parts.push(value);
  }
  if (parts.length === 1) return parts[0]!;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

type Statements = [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];

/**
 * Statements (for one batch) that store `file` as the post's HTML, replacing
 * any earlier file and all of its pieces. A replacement keeps
 * `discord_message_id`, so running the Discord command on the same message
 * again still points at this post. The batch must also contain (or follow) the
 * posts row, since pieces reference posts(id).
 */
export function writePostHtml(
  db: Db,
  postId: string,
  file: HtmlFile,
  now: number,
  via: "site" | "discord",
  discordMessageId: string | null = null,
): Statements {
  const [first = "", ...rest] = file.pieces;
  return [
    db
      .insert(postHtml)
      .values({
        postId,
        html: first,
        filename: file.filename,
        size: file.size,
        uploadedAt: now,
        uploadedVia: via,
        discordMessageId,
        chunkCount: rest.length,
      })
      .onConflictDoUpdate({
        target: postHtml.postId,
        set: {
          html: sql`excluded.html`,
          filename: sql`excluded.filename`,
          size: sql`excluded.size`,
          uploadedAt: sql`excluded.uploaded_at`,
          uploadedVia: sql`excluded.uploaded_via`,
          chunkCount: sql`excluded.chunk_count`,
        },
      }),
    db.delete(postHtmlChunks).where(eq(postHtmlChunks.postId, postId)),
    // One statement per piece: each bound value stays under the D1 value cap.
    ...rest.map((data, i) => db.insert(postHtmlChunks).values({ postId, seq: i + 1, data })),
  ];
}

/** Statements (for one batch) that remove the post's HTML and all of its pieces. */
export function deletePostHtml(db: Db, postId: string): Statements {
  return [
    db.delete(postHtmlChunks).where(eq(postHtmlChunks.postId, postId)),
    db.delete(postHtml).where(eq(postHtml.postId, postId)),
  ];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Only the head is scanned for <title>, so a large file costs no extra CPU. */
const TITLE_SCAN_CHARS = 64 * 1024;

/** Text of the first <title> element (linear scans only, no backtracking regex). */
function rawTitle(html: string): string {
  const head = html.slice(0, TITLE_SCAN_CHARS);
  const open = head.search(/<title[\s>]/i);
  if (open < 0) return "";
  const start = head.indexOf(">", open) + 1;
  if (start === 0) return "";
  const end = head.slice(start).search(/<\/title/i);
  if (end < 0) return "";
  return head.slice(start, start + Math.min(end, 2_000));
}

/**
 * Post title for an HTML file posted from Discord (D-32): the document's
 * <title>, else the file name without its extension; at most 200 chars.
 */
export function htmlTitle(html: string, filename: string): string {
  const fromTitle = decodeEntities(rawTitle(html)).replace(/\s+/g, " ").trim();
  const fromName = filename.replace(/\.html?$/i, "").replace(/\s+/g, " ").trim();
  const title = fromTitle || fromName || "HTML 문서";
  // UTF-16 length, as the zod schema counts it; never split a surrogate pair.
  return title.slice(0, LIMITS.postTitleMax).replace(/[\uD800-\uDBFF]$/, "");
}
