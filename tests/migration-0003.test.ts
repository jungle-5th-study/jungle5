// Migration 0003 (post_html, TD-25) on top of 0000–0002 with data: additive
// only (TSD 9.2), so every existing row survives; the new table cascades with
// its post and keeps Discord message ids unique.
// Its own file so MIGRATION_DB starts empty (storage is isolated per test file).
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const db = env.MIGRATION_DB;
const [m0, m1, m2, m3] = env.TEST_MIGRATIONS;
const T = 1_791_400_000_000;
const ids = {
  member: "01900000-0000-7000-8000-00000000a001",
  study: "01900000-0000-7000-8000-00000000c001",
  round: "01900000-0000-7000-8000-00000000d001",
  post: "01900000-0000-7000-8000-00000000e001",
  post2: "01900000-0000-7000-8000-00000000e002",
  category: "01900000-0000-7000-8000-000000000001", // seeded 기타
};

const tableSnapshot = async (table: string) => (await db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results;
const count = async (sql: string, ...params: unknown[]) =>
  (await db.prepare(sql).bind(...params).first<{ n: number }>())?.n;

describe("migration 0003 (post_html)", () => {
  it("adds post_html and keeps all existing data", async () => {
    expect(m3?.name).toBe("0003_post_html.sql");
    await applyD1Migrations(db, [m0!, m1!, m2!]);
    await db.batch([
      db
        .prepare(
          "INSERT INTO members (id, discord_user_id, display_name, is_admin, is_guild_member, verified_at, created_at, discord_role_ids) VALUES (?, '1', 'a', 1, 1, ?, ?, '[\"123456789012345678\"]')",
        )
        .bind(ids.member, T, T),
      db
        .prepare(
          "INSERT INTO studies (id, name, goal, status, discord_role_id, version, created_at, updated_at) VALUES (?, 'DDIA', '완독', 'active', '123456789012345678', 2, ?, ?)",
        )
        .bind(ids.study, T, T),
      db.prepare("INSERT INTO study_members (study_id, member_id, joined_at) VALUES (?, ?, ?)").bind(ids.study, ids.member, T),
      db
        .prepare(
          "INSERT INTO rounds (id, study_id, seq, title, scope, goal, created_by, created_at) VALUES (?, ?, 1, '1회차', '범위', '목표', ?, ?)",
        )
        .bind(ids.round, ids.study, ids.member, T),
      db
        .prepare(
          "INSERT INTO posts (id, title, body, category_id, author_id, round_id, links, created_at, updated_at) VALUES (?, '글', '본문', ?, ?, ?, '[]', ?, ?), (?, '글2', '본문2', ?, ?, NULL, '[]', ?, ?)",
        )
        .bind(ids.post, ids.category, ids.member, ids.round, T, T, ids.post2, ids.category, ids.member, T, T),
      db
        .prepare("INSERT INTO comments (id, post_id, author_id, body, created_at, updated_at) VALUES ('c1', ?, ?, 'x', ?, ?)")
        .bind(ids.post, ids.member, T, T),
      db.prepare("INSERT INTO tags (id, name, name_key) VALUES ('t1', 'hono', 'hono')"),
      db.prepare("INSERT INTO post_tags (post_id, tag_id) VALUES (?, 't1')").bind(ids.post),
    ]);
    const tables = ["members", "studies", "study_members", "rounds", "posts", "comments", "categories", "tags", "post_tags"];
    const before = Object.fromEntries(await Promise.all(tables.map(async (t) => [t, await tableSnapshot(t)] as const)));

    await applyD1Migrations(db, [m0!, m1!, m2!, m3!]);
    const applied = await db.prepare("SELECT name FROM d1_migrations ORDER BY id").all<{ name: string }>();
    expect(applied.results.map((r) => r.name)).toEqual([m0!.name, m1!.name, m2!.name, m3!.name]);
    for (const t of tables) expect(await tableSnapshot(t)).toEqual(before[t]);
    expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);

    const cols = (await db.prepare("PRAGMA table_info(post_html)").all<{ name: string; pk: number }>()).results;
    expect(cols.map((c) => c.name)).toEqual([
      "post_id",
      "html",
      "filename",
      "size",
      "uploaded_at",
      "uploaded_via",
      "discord_message_id",
    ]);
    expect(cols.find((c) => c.pk === 1)?.name).toBe("post_id");
    expect(cols.map((c) => c.name)).not.toContain("text"); // HTML is not searchable (TSD 3.2)

    // Works: insert, one per post, CHECK on uploaded_via, unique Discord message id.
    const insert = (postId: string, via: string, msg: string | null) =>
      db
        .prepare("INSERT INTO post_html (post_id, html, filename, size, uploaded_at, uploaded_via, discord_message_id) VALUES (?, '<p>x</p>', 'a.html', 8, ?, ?, ?)")
        .bind(postId, T, via, msg)
        .run();
    await insert(ids.post, "discord", "m1");
    await expect(insert(ids.post, "site", null)).rejects.toThrow();
    await expect(insert(ids.post2, "email", null)).rejects.toThrow();
    await expect(insert(ids.post2, "site", "m1")).rejects.toThrow();
    await expect(insert("no-such-post", "site", null)).rejects.toThrow();
    await insert(ids.post2, "site", null);

    // Deleting a post deletes its HTML (and only its HTML).
    await db.prepare("DELETE FROM posts WHERE id = ?").bind(ids.post).run();
    expect(await count("SELECT count(*) AS n FROM post_html WHERE post_id = ?", ids.post)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM post_html WHERE post_id = ?", ids.post2)).toBe(1);
  });
});
