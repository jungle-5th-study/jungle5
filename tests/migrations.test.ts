// TD-24 migration 0001 on a non-empty database: the table rebuilds must not
// lose rows through ON DELETE CASCADE / SET NULL, and the dropped columns must
// be gone. Uses its own empty D1 (MIGRATION_DB) so 0000 can be applied alone.
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const db = env.MIGRATION_DB;
const [m0, m1] = env.TEST_MIGRATIONS;

const columns = async (table: string) =>
  (await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()).results.map((c) => c.name);
const count = async (sql: string, ...params: unknown[]) =>
  (await db.prepare(sql).bind(...params).first<{ n: number }>())?.n;

const T = 1_791_400_000_000;
const ids = {
  author: "01900000-0000-7000-8000-00000000a001",
  member2: "01900000-0000-7000-8000-00000000a002",
  category: "01900000-0000-7000-8000-000000000001", // seeded 기타
  tag1: "01900000-0000-7000-8000-00000000b001",
  tag2: "01900000-0000-7000-8000-00000000b002",
  study: "01900000-0000-7000-8000-00000000c001",
  round: "01900000-0000-7000-8000-00000000d001",
  post: "01900000-0000-7000-8000-00000000e001",
  post2: "01900000-0000-7000-8000-00000000e002",
};

describe("migration 0001 (TD-24)", () => {
  it("rebuilds posts/studies without losing comments, tags, rounds or study members", async () => {
    expect(m0?.name).toMatch(/^0000_/);
    expect(m1?.name).toMatch(/^0001_/);
    await applyD1Migrations(db, [m0!]);
    expect(await columns("posts")).toEqual(expect.arrayContaining(["kind", "question_status"]));
    expect(await columns("studies")).toContain("manager_id");

    await db.batch([
      db
        .prepare(
          "INSERT INTO members (id, discord_user_id, display_name, is_admin, is_guild_member, verified_at, created_at) VALUES (?, '1', 'a', 0, 1, ?, ?), (?, '2', 'b', 0, 1, ?, ?)",
        )
        .bind(ids.author, T, T, ids.member2, T, T),
      db.prepare("INSERT INTO tags (id, name, name_key) VALUES (?, 'hono', 'hono'), (?, 'd1', 'd1')").bind(ids.tag1, ids.tag2),
      db
        .prepare(
          "INSERT INTO studies (id, name, goal, description, status, manager_id, version, created_at, updated_at) VALUES (?, 'DDIA', '완독', '설명', 'active', ?, 3, ?, ?)",
        )
        .bind(ids.study, ids.author, T, T),
      db
        .prepare("INSERT INTO study_members (study_id, member_id, joined_at) VALUES (?, ?, ?), (?, ?, ?)")
        .bind(ids.study, ids.author, T, ids.study, ids.member2, T + 1),
      db
        .prepare(
          "INSERT INTO rounds (id, study_id, seq, title, scope, goal, notes_discussion, notes_version, created_by, created_at) VALUES (?, ?, 1, '1회차', '1-3장', '이해', '논의', 4, ?, ?)",
        )
        .bind(ids.round, ids.study, ids.author, T),
      db
        .prepare(
          `INSERT INTO posts (id, kind, title, body, category_id, author_id, round_id, links, recommend_reason, question_status, resolution_summary, hidden_at, hidden_by, created_at, updated_at)
           VALUES (?, 'question', '질문', '본문', ?, ?, ?, '[{"url":"https://a.b","label":""}]', NULL, 'resolved', '요약', ?, ?, ?, ?),
                  (?, 'resource', '자료', '본문2', ?, ?, NULL, '[]', '추천', NULL, NULL, NULL, NULL, ?, ?)`,
        )
        .bind(ids.post, ids.category, ids.author, ids.round, T + 5, ids.member2, T, T + 1, ids.post2, ids.category, ids.member2, T, T),
      db.prepare("INSERT INTO post_tags (post_id, tag_id) VALUES (?, ?), (?, ?), (?, ?)").bind(
        ids.post,
        ids.tag1,
        ids.post,
        ids.tag2,
        ids.post2,
        ids.tag1,
      ),
      db
        .prepare(
          `INSERT INTO comments (id, post_id, round_id, author_id, body, created_at, updated_at) VALUES
           ('c1', ?, NULL, ?, '글 댓글1', ?, ?), ('c2', ?, NULL, ?, '글 댓글2', ?, ?), ('c3', NULL, ?, ?, '회차 댓글', ?, ?)`,
        )
        .bind(ids.post, ids.member2, T, T, ids.post, ids.author, T, T, ids.round, ids.author, T, T),
    ]);

    await applyD1Migrations(db, [m0!, m1!]);
    const applied = await db.prepare("SELECT name FROM d1_migrations ORDER BY id").all<{ name: string }>();
    expect(applied.results.map((r) => r.name)).toEqual([m0!.name, m1!.name]);

    // Dropped / added columns.
    const postCols = await columns("posts");
    for (const gone of ["kind", "recommend_reason", "question_status", "resolution_summary"]) {
      expect(postCols).not.toContain(gone);
    }
    expect(postCols).toEqual([
      "id",
      "title",
      "body",
      "category_id",
      "author_id",
      "round_id",
      "links",
      "hidden_at",
      "hidden_by",
      "created_at",
      "updated_at",
    ]);
    const studyCols = await columns("studies");
    expect(studyCols).not.toContain("manager_id");
    expect(studyCols).toEqual(expect.arrayContaining(["discord_role_id", "join_guide"]));

    // Every row survived, with its data.
    expect(await count("SELECT count(*) AS n FROM posts")).toBe(2);
    expect(await count("SELECT count(*) AS n FROM comments")).toBe(3);
    expect(await count("SELECT count(*) AS n FROM post_tags")).toBe(3);
    expect(await count("SELECT count(*) AS n FROM study_members")).toBe(2);
    expect(await count("SELECT count(*) AS n FROM rounds")).toBe(1);
    expect(await count("SELECT count(*) AS n FROM studies")).toBe(1);
    expect(await db.prepare("SELECT * FROM posts WHERE id = ?").bind(ids.post).first()).toEqual({
      id: ids.post,
      title: "질문",
      body: "본문",
      category_id: ids.category,
      author_id: ids.author,
      round_id: ids.round, // not SET NULL by the rounds rebuild
      links: '[{"url":"https://a.b","label":""}]',
      hidden_at: T + 5,
      hidden_by: ids.member2,
      created_at: T,
      updated_at: T + 1,
    });
    expect(await db.prepare("SELECT * FROM studies").first()).toEqual({
      id: ids.study,
      name: "DDIA",
      goal: "완독",
      description: "설명",
      materials: null,
      cadence: null,
      status: "active",
      discord_role_id: `unlinked:${ids.study}`,
      join_guide: null,
      hidden_at: null,
      hidden_by: null,
      version: 3,
      created_at: T,
      updated_at: T,
    });
    expect(
      await db.prepare("SELECT notes_discussion, notes_version FROM rounds WHERE id = ?").bind(ids.round).first(),
    ).toEqual({ notes_discussion: "논의", notes_version: 4 });
    expect(await count("SELECT count(*) AS n FROM study_members WHERE member_id = ? AND joined_at = ?", ids.member2, T + 1)).toBe(1);

    // No backup tables left; indexes recreated; no FK violations.
    const objects = (
      await db.prepare("SELECT type, name FROM sqlite_master WHERE type IN ('table', 'index')").all<{ type: string; name: string }>()
    ).results.map((o) => o.name);
    expect(objects.filter((n) => n.startsWith("_bak"))).toEqual([]);
    expect(objects).not.toContain("studies_manager_idx");
    expect(objects).toEqual(
      expect.arrayContaining([
        "studies_discord_role_id_unique",
        "study_members_member_idx",
        "rounds_study_seq_uq",
        "rounds_meeting_idx",
        "posts_created_idx",
        "posts_category_created_idx",
        "posts_round_idx",
        "posts_author_idx",
        "post_tags_tag_idx",
        "comments_post_idx",
        "comments_round_idx",
      ]),
    );
    expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);

    // The rebuilt tables' foreign keys are live: cascades still work.
    await db.prepare("DELETE FROM posts WHERE id = ?").bind(ids.post).run();
    expect(await count("SELECT count(*) AS n FROM comments WHERE post_id = ?", ids.post)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM post_tags WHERE post_id = ?", ids.post)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM post_tags")).toBe(1);
    await db.prepare("DELETE FROM studies WHERE id = ?").bind(ids.study).run();
    expect(await count("SELECT count(*) AS n FROM rounds")).toBe(0);
    expect(await count("SELECT count(*) AS n FROM study_members")).toBe(0);
    expect(await count("SELECT count(*) AS n FROM comments")).toBe(0); // round comment c3
    expect(await db.prepare("SELECT round_id FROM posts WHERE id = ?").bind(ids.post2).first()).toEqual({ round_id: null });

    // discord_role_id is UNIQUE NOT NULL.
    const insertStudy = (id: string, role: string | null) =>
      db
        .prepare(
          "INSERT INTO studies (id, name, goal, status, discord_role_id, version, created_at, updated_at) VALUES (?, 'x', 'g', 'active', ?, 1, ?, ?)",
        )
        .bind(id, role, T, T)
        .run();
    await insertStudy("s1", "role-1");
    await expect(insertStudy("s2", "role-1")).rejects.toThrow(/UNIQUE/);
    await expect(insertStudy("s3", null)).rejects.toThrow(/NOT NULL/);
  });
});
