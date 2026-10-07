// Migration 0002 (members.discord_role_ids) on top of 0000 + 0001 with data:
// additive only (TSD 9.2), so every existing row survives unchanged.
// Its own file so MIGRATION_DB starts empty (storage is isolated per test file).
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const db = env.MIGRATION_DB;
const [m0, m1, m2] = env.TEST_MIGRATIONS;
const T = 1_791_400_000_000;
const ids = {
  member: "01900000-0000-7000-8000-00000000a001",
  study: "01900000-0000-7000-8000-00000000c001",
  round: "01900000-0000-7000-8000-00000000d001",
  post: "01900000-0000-7000-8000-00000000e001",
  category: "01900000-0000-7000-8000-000000000001", // seeded 기타
};

const count = async (table: string) => (await db.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())?.n;
const tableSnapshot = async (table: string) => (await db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results;

describe("migration 0002 (members.discord_role_ids)", () => {
  it("adds a nullable column and keeps all existing data", async () => {
    expect(m2?.name).toBe("0002_members_discord_role_ids.sql");
    await applyD1Migrations(db, [m0!, m1!]);
    await db.batch([
      db
        .prepare(
          "INSERT INTO members (id, discord_user_id, display_name, is_admin, is_guild_member, verified_at, created_at) VALUES (?, '1', 'a', 1, 1, ?, ?)",
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
          "INSERT INTO rounds (id, study_id, seq, title, scope, goal, notes_discussion, notes_version, created_by, created_at) VALUES (?, ?, 1, '1회차', '범위', '목표', '논의', 3, ?, ?)",
        )
        .bind(ids.round, ids.study, ids.member, T),
      db
        .prepare(
          "INSERT INTO posts (id, title, body, category_id, author_id, round_id, links, created_at, updated_at) VALUES (?, '글', '본문', ?, ?, ?, '[]', ?, ?)",
        )
        .bind(ids.post, ids.category, ids.member, ids.round, T, T),
      db
        .prepare(
          "INSERT INTO comments (id, post_id, round_id, author_id, body, created_at, updated_at) VALUES ('c1', ?, NULL, ?, 'x', ?, ?), ('c2', NULL, ?, ?, 'y', ?, ?)",
        )
        .bind(ids.post, ids.member, T, T, ids.round, ids.member, T, T),
    ]);
    const tables = ["studies", "study_members", "rounds", "posts", "comments", "categories"];
    const before = Object.fromEntries(await Promise.all(tables.map(async (t) => [t, await tableSnapshot(t)] as const)));
    const memberBefore = await db.prepare("SELECT * FROM members WHERE id = ?").bind(ids.member).first();

    await applyD1Migrations(db, [m0!, m1!, m2!]);
    const applied = await db.prepare("SELECT name FROM d1_migrations ORDER BY id").all<{ name: string }>();
    expect(applied.results.map((r) => r.name)).toEqual([m0!.name, m1!.name, m2!.name]);

    const cols = (await db.prepare("PRAGMA table_info(members)").all<{ name: string; notnull: number; dflt_value: unknown }>()).results;
    expect(cols.at(-1)).toMatchObject({ name: "discord_role_ids", notnull: 0, dflt_value: null });

    for (const t of tables) expect(await tableSnapshot(t)).toEqual(before[t]);
    expect(await db.prepare("SELECT * FROM members WHERE id = ?").bind(ids.member).first()).toEqual({
      ...memberBefore,
      discord_role_ids: null,
    });
    expect(await count("comments")).toBe(2);
    expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);

    // The new column takes the JSON array the app writes and json_each can read it.
    await db.prepare("UPDATE members SET discord_role_ids = ? WHERE id = ?").bind('["123456789012345678"]', ids.member).run();
    const match = await db
      .prepare("SELECT count(*) AS n FROM members m WHERE '123456789012345678' IN (SELECT value FROM json_each(COALESCE(m.discord_role_ids, '[]')))")
      .first<{ n: number }>();
    expect(match?.n).toBe(1);
  });
});
