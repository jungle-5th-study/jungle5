// Migration 0005 (gzip storage, TD-25) on top of 0000–0004 with data: additive
// only (TSD 9.2). Existing identity rows (one piece and multi-piece) keep
// their content, get encoding 'identity' and stored_size = size, and are still
// served unchanged by the HTML worker; the new blobs table cascades with its
// post and enforces its constraints.
// Its own file so MIGRATION_DB starts empty (storage is isolated per test file).
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { handleHtmlRequest } from "../src/html-worker/index";
import { buildHtmlUrl } from "../src/worker/lib/htmlSigning";

const db = env.MIGRATION_DB;
const migrations = env.TEST_MIGRATIONS;
const T = 1_791_600_000_000;
const ids = {
  member: "01900000-0000-7000-8000-00000000a001",
  post: "01900000-0000-7000-8000-00000000f001",
  post2: "01900000-0000-7000-8000-00000000f002",
  category: "01900000-0000-7000-8000-000000000001", // seeded 기타
};

const tableSnapshot = async (table: string) => (await db.prepare(`SELECT * FROM ${table} ORDER BY 1, 2`).all()).results;
const count = async (sql: string, ...params: unknown[]) =>
  (await db.prepare(sql).bind(...params).first<{ n: number }>())?.n;

describe("migration 0005 (post_html gzip: encoding, stored_size, post_html_blobs)", () => {
  it("adds the columns and table; existing identity rows are intact and still served", async () => {
    expect(migrations.map((m) => m.name).slice(0, 6)).toEqual([
      "0000_init.sql",
      "0001_cleanup_kinds_managers.sql",
      "0002_members_discord_role_ids.sql",
      "0003_post_html.sql",
      "0004_post_html_chunks.sql",
      "0005_post_html_gzip.sql",
    ]);
    await applyD1Migrations(db, migrations.slice(0, 5));

    // A one-piece file and a two-piece file (piece 0 + chunk 1), written under 0004.
    const small = "<title>작은 파일</title><p>그대로</p>";
    const piece0 = "가".repeat(10_000);
    const piece1 = "<p>둘째 조각</p>";
    const enc = new TextEncoder();
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
          "INSERT INTO post_html (post_id, html, filename, size, uploaded_at, uploaded_via, discord_message_id, chunk_count) VALUES (?, ?, 'a.html', ?, ?, 'discord', 'm1', 0), (?, ?, 'b.html', ?, ?, 'site', NULL, 1)",
        )
        .bind(ids.post, small, enc.encode(small).length, T, ids.post2, piece0, enc.encode(piece0 + piece1).length, T),
      db.prepare("INSERT INTO post_html_chunks (post_id, seq, data) VALUES (?, 1, ?)").bind(ids.post2, piece1),
    ]);
    const tables = ["members", "posts", "categories", "post_html_chunks"];
    const before = Object.fromEntries(await Promise.all(tables.map(async (t) => [t, await tableSnapshot(t)] as const)));
    const htmlBefore = await tableSnapshot("post_html");

    await applyD1Migrations(db, migrations.slice(0, 6));
    const applied = await db.prepare("SELECT name FROM d1_migrations ORDER BY id").all<{ name: string }>();
    expect(applied.results.map((r) => r.name)).toEqual(migrations.slice(0, 6).map((m) => m.name));
    for (const t of tables) expect(await tableSnapshot(t)).toEqual(before[t]);
    expect(await tableSnapshot("post_html")).toEqual(
      htmlBefore.map((r) => ({ ...r, encoding: "identity", stored_size: r.size })),
    );
    expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);

    const cols = (await db.prepare("PRAGMA table_info(post_html_blobs)").all<{ name: string; type: string; pk: number; notnull: number }>()).results;
    expect(cols.map((c) => [c.name, c.type, c.pk, c.notnull])).toEqual([
      ["post_id", "TEXT", 1, 1],
      ["seq", "INTEGER", 2, 1],
      ["data", "BLOB", 0, 1],
    ]);

    // Both old rows are served exactly as before (no Content-Encoding).
    for (const [id, text] of [
      [ids.post, small],
      [ids.post2, piece0 + piece1],
    ] as const) {
      const url = await buildHtmlUrl("https://jungle5-html.test", env.HTML_SIGNING_KEY, id, Math.floor(Date.now() / 1000) + 60);
      const served = await handleHtmlRequest(new Request(url), { DB: db, HTML_SIGNING_KEY: env.HTML_SIGNING_KEY });
      expect(served.status).toBe(200);
      expect(served.headers.get("Content-Encoding")).toBeNull();
      expect(served.headers.get("Content-Length")).toBe(String(enc.encode(text).length));
      expect(await served.text()).toBe(text);
    }

    // encoding CHECK; default for rows inserted the old way (no encoding column named).
    await expect(db.prepare("UPDATE post_html SET encoding = 'br' WHERE post_id = ?").bind(ids.post).run()).rejects.toThrow();
    await db.prepare("UPDATE post_html SET encoding = 'gzip' WHERE post_id = ?").bind(ids.post).run();
    await db.prepare("UPDATE post_html SET encoding = 'identity' WHERE post_id = ?").bind(ids.post).run();

    // Blob constraints: (post_id, seq) unique, seq ≥ 0, data NOT NULL, post must exist.
    const insert = (postId: string, seq: number, hex: string | null = "1f8b") =>
      db.prepare("INSERT INTO post_html_blobs (post_id, seq, data) VALUES (?, ?, unhex(?))").bind(postId, seq, hex).run();
    await insert(ids.post2, 0);
    await insert(ids.post2, 1);
    await expect(insert(ids.post2, 1)).rejects.toThrow();
    await expect(insert(ids.post2, -1)).rejects.toThrow();
    await expect(insert(ids.post2, 2, null)).rejects.toThrow();
    await expect(insert("no-such-post", 0)).rejects.toThrow();
    expect(await db.prepare("SELECT typeof(data) AS t, hex(data) AS h FROM post_html_blobs WHERE post_id = ? AND seq = 0").bind(ids.post2).first()).toEqual({
      t: "blob",
      h: "1F8B",
    });

    // Deleting a post deletes its blobs (and only its blobs).
    await insert(ids.post, 0);
    await db.prepare("DELETE FROM posts WHERE id = ?").bind(ids.post2).run();
    expect(await count("SELECT count(*) AS n FROM post_html_blobs WHERE post_id = ?", ids.post2)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM post_html_chunks WHERE post_id = ?", ids.post2)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM post_html_blobs WHERE post_id = ?", ids.post)).toBe(1);
  });
});
