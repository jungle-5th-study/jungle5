// Migration 0004 (post_html_chunks, TD-25) on top of 0000–0003 with data:
// additive only (TSD 9.2). An existing post_html row (≤ 1.5 MB, one piece)
// keeps its content, gets chunk_count 0 and is still served unchanged by the
// HTML worker; the new table cascades with its post.
// Its own file so MIGRATION_DB starts empty (storage is isolated per test file).
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { handleHtmlRequest } from "../src/html-worker/index";
import { buildHtmlUrl } from "../src/worker/lib/htmlSigning";

const db = env.MIGRATION_DB;
const [m0, m1, m2, m3, m4] = env.TEST_MIGRATIONS;
const T = 1_791_500_000_000;
const ids = {
  member: "01900000-0000-7000-8000-00000000a001",
  post: "01900000-0000-7000-8000-00000000e001",
  post2: "01900000-0000-7000-8000-00000000e002",
  category: "01900000-0000-7000-8000-000000000001", // seeded 기타
};

const tableSnapshot = async (table: string) => (await db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results;
const count = async (sql: string, ...params: unknown[]) =>
  (await db.prepare(sql).bind(...params).first<{ n: number }>())?.n;

describe("migration 0004 (post_html_chunks)", () => {
  it("adds the pieces table and chunk_count; an existing 1.5 MB file is untouched and still served", async () => {
    expect(m4?.name).toBe("0004_post_html_chunks.sql");
    await applyD1Migrations(db, [m0!, m1!, m2!, m3!]);

    // An existing upload at the old limit: Hangul (3 bytes each) + ASCII = exactly 1,500,000 bytes.
    const head = "<title>옛 파일</title>";
    const oldHtml = head + "가".repeat(400_000) + "x".repeat(1_500_000 - new TextEncoder().encode(head).length - 1_200_000);
    const oldSize = new TextEncoder().encode(oldHtml).length;
    expect(oldSize).toBe(1_500_000);
    await db.batch([
      db
        .prepare(
          "INSERT INTO members (id, discord_user_id, display_name, is_admin, is_guild_member, verified_at, created_at) VALUES (?, '1', 'a', 0, 1, ?, ?)",
        )
        .bind(ids.member, T, T),
      db
        .prepare(
          "INSERT INTO posts (id, title, body, category_id, author_id, links, created_at, updated_at) VALUES (?, '글', '본문', ?, ?, '[]', ?, ?), (?, '글2', '본문2', ?, ?, '[]', ?, ?)",
        )
        .bind(ids.post, ids.category, ids.member, T, T, ids.post2, ids.category, ids.member, T, T),
      db
        .prepare(
          "INSERT INTO post_html (post_id, html, filename, size, uploaded_at, uploaded_via, discord_message_id) VALUES (?, ?, '옛.html', ?, ?, 'discord', 'm1')",
        )
        .bind(ids.post, oldHtml, oldSize, T),
    ]);
    const tables = ["members", "posts", "categories"];
    const before = Object.fromEntries(await Promise.all(tables.map(async (t) => [t, await tableSnapshot(t)] as const)));
    const htmlBefore = await tableSnapshot("post_html");

    await applyD1Migrations(db, [m0!, m1!, m2!, m3!, m4!]);
    const applied = await db.prepare("SELECT name FROM d1_migrations ORDER BY id").all<{ name: string }>();
    expect(applied.results.map((r) => r.name)).toEqual([m0, m1, m2, m3, m4].map((m) => m!.name));
    for (const t of tables) expect(await tableSnapshot(t)).toEqual(before[t]);
    expect(await tableSnapshot("post_html")).toEqual(htmlBefore.map((r) => ({ ...r, chunk_count: 0 })));
    expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);

    const cols = (await db.prepare("PRAGMA table_info(post_html_chunks)").all<{ name: string; pk: number; notnull: number }>()).results;
    expect(cols.map((c) => [c.name, c.pk, c.notnull])).toEqual([
      ["post_id", 1, 1],
      ["seq", 2, 1],
      ["data", 0, 1],
    ]);

    // The HTML worker serves the old row exactly as before. The current worker
    // also reads 0005's columns (deploys apply migrations first), so bring the
    // schema up to date before serving.
    await applyD1Migrations(db, env.TEST_MIGRATIONS);
    const url = await buildHtmlUrl("https://jungle5-html.test", env.HTML_SIGNING_KEY, ids.post, Math.floor(Date.now() / 1000) + 60);
    const served = await handleHtmlRequest(new Request(url), { DB: db, HTML_SIGNING_KEY: env.HTML_SIGNING_KEY });
    expect(served.status).toBe(200);
    expect(served.headers.get("Content-Length")).toBe(String(oldSize));
    expect(await served.text()).toBe(oldHtml);

    // Constraints: (post_id, seq) unique, seq ≥ 1, post must exist.
    const insert = (postId: string, seq: number) =>
      db.prepare("INSERT INTO post_html_chunks (post_id, seq, data) VALUES (?, ?, 'x')").bind(postId, seq).run();
    await insert(ids.post2, 1);
    await insert(ids.post2, 2);
    await expect(insert(ids.post2, 1)).rejects.toThrow();
    await expect(insert(ids.post2, 0)).rejects.toThrow();
    await expect(insert("no-such-post", 1)).rejects.toThrow();

    // Deleting a post deletes its pieces (and only its pieces).
    await insert(ids.post, 1);
    await db.prepare("DELETE FROM posts WHERE id = ?").bind(ids.post2).run();
    expect(await count("SELECT count(*) AS n FROM post_html_chunks WHERE post_id = ?", ids.post2)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM post_html_chunks WHERE post_id = ?", ids.post)).toBe(1);
  });
});
