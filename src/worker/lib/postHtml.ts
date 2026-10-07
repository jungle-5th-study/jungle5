// Storing a post's attached HTML (D-30, TD-25). Used by the posts routes and
// the Discord message command (D-32).
import { sql } from "drizzle-orm";
import { LIMITS } from "../../shared/constants";
import { utf8ByteLength } from "../../shared/schemas";
import { postHtml } from "../db/schema";
import type { Db } from "../types";

export interface HtmlFile {
  filename: string;
  html: string;
}

/**
 * Insert-or-replace statement for the post's HTML (one statement, for a batch).
 * A replacement keeps `discord_message_id`, so running the Discord command on
 * the same message again still points at this post.
 */
export function upsertPostHtml(
  db: Db,
  postId: string,
  file: HtmlFile,
  now: number,
  via: "site" | "discord",
  discordMessageId: string | null = null,
) {
  return db
    .insert(postHtml)
    .values({
      postId,
      html: file.html,
      filename: file.filename,
      size: utf8ByteLength(file.html),
      uploadedAt: now,
      uploadedVia: via,
      discordMessageId,
    })
    .onConflictDoUpdate({
      target: postHtml.postId,
      set: {
        html: sql`excluded.html`,
        filename: sql`excluded.filename`,
        size: sql`excluded.size`,
        uploadedAt: sql`excluded.uploaded_at`,
        uploadedVia: sql`excluded.uploaded_via`,
      },
    });
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
