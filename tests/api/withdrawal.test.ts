// Withdrawal (PRD F-11, D-20; TSD 5.2, 8.3).
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  call,
  countSessions,
  createPost,
  createStudy,
  insertStudy,
  login,
  makeApp,
  newSnowflake,
  studyIdsOf,
  uuidv7,
} from "../helpers";

const app = makeApp();

describe("withdrawal", () => {
  it("anonymizes the member, keeps content readable, drops sessions; re-login creates a new member", async () => {
    const discordUserId = "550000000000000001";
    const leaver = await login(app, { discordUserId, displayName: "떠나는사람" });
    const before = await call(app, "GET", "/api/me", { cookie: leaver.cookie });
    expect(before.json.avatarUrl).toContain(discordUserId);
    const reader = await login(app);
    const post = await createPost(app, leaver, { title: "남는 글", tags: ["legacy"] });
    const onOthers = await createPost(app, reader);
    await call(app, "POST", `/api/posts/${onOthers.id}/comments`, {
      cookie: leaver.cookie,
      body: { id: uuidv7(), body: "남는 댓글" },
    });

    const res = await call(app, "DELETE", "/api/me", { cookie: leaver.cookie });
    expect(res.status).toBe(204);
    expect(res.headers.get("Set-Cookie") ?? "").toMatch(/j5_session=;/);

    // Sessions and tokens are gone.
    expect(await countSessions(leaver.memberId)).toBe(0);
    expect((await call(app, "GET", "/api/me", { cookie: leaver.cookie })).status).toBe(401);
    const tokens = await env.DB.prepare("SELECT count(*) AS n FROM discord_tokens WHERE member_id = ?")
      .bind(leaver.memberId)
      .first<{ n: number }>();
    expect(tokens?.n).toBe(0);

    // Content remains, attributed to an anonymous withdrawn member.
    const detail = await call(app, "GET", `/api/posts/${post.id}`, { cookie: reader.cookie });
    expect(detail.status).toBe(200);
    expect(detail.json.title).toBe("남는 글");
    expect(detail.json.author).toEqual({ id: leaver.memberId, displayName: null, avatarUrl: null, withdrawn: true });
    const commented = await call(app, "GET", `/api/posts/${onOthers.id}`, { cookie: reader.cookie });
    expect(commented.json.comments[0]).toMatchObject({ body: "남는 댓글", author: { displayName: null, withdrawn: true } });

    // No API response mentions the old name, avatar or Discord id.
    const responses = [
      detail,
      commented,
      await call(app, "GET", "/api/posts", { cookie: reader.cookie }),
      await call(app, "GET", "/api/posts?tag=legacy", { cookie: reader.cookie }),
      await call(app, "GET", "/api/home", { cookie: reader.cookie }),
      await call(app, "GET", "/api/categories", { cookie: reader.cookie }),
    ];
    for (const r of responses) {
      expect(r.status).toBe(200);
      expect(r.text).not.toContain("떠나는사람");
      expect(r.text).not.toContain(discordUserId);
      // test-login avatars embed the Discord id, so this also covers the avatar URL.
    }

    // The row itself is scrubbed.
    const row = await env.DB.prepare(
      "SELECT discord_user_id, display_name, avatar_url, withdrawn_at FROM members WHERE id = ?",
    )
      .bind(leaver.memberId)
      .first<Record<string, unknown>>();
    expect(row).toMatchObject({ discord_user_id: null, display_name: null, avatar_url: null });
    expect(row?.withdrawn_at).toEqual(expect.any(Number));

    // Same Discord account → brand-new member, not linked to old content.
    const again = await login(app, { discordUserId, displayName: "돌아온사람" });
    expect(again.memberId).not.toBe(leaver.memberId);
    const me = await call(app, "GET", "/api/me", { cookie: again.cookie });
    expect(me.json).toMatchObject({ id: again.memberId, displayName: "돌아온사람" });
    const oldPost = await call(app, "GET", `/api/posts/${post.id}`, { cookie: again.cookie });
    expect(oldPost.json.author.id).toBe(leaver.memberId);
    expect((await call(app, "PATCH", `/api/posts/${post.id}`, { cookie: again.cookie, body: { title: "x" } })).status).toBe(403);
  });

  it("removes study memberships and is never blocked by a study (D-24)", async () => {
    const study = await insertStudy({ name: "s" });
    const ended = await insertStudy({ name: "끝난 스터디", status: "ended" });
    const leaver = await login(app, { roles: [study.roleId, ended.roleId] });
    const stayer = await login(app, { roles: [study.roleId] });
    const before = await call(app, "GET", "/api/me", { cookie: leaver.cookie });
    expect(before.json.studies).toEqual(
      expect.arrayContaining([
        { id: study.id, name: "s", status: "active" },
        { id: ended.id, name: "끝난 스터디", status: "ended" },
      ]),
    );
    // Formerly a "manager" would have been blocked with 409; now nothing blocks withdrawal.
    const res = await call(app, "DELETE", "/api/me", { cookie: leaver.cookie });
    expect(res.status).toBe(204);
    expect(await studyIdsOf(leaver.memberId)).toEqual([]);
    expect(await countSessions(leaver.memberId)).toBe(0);
    // Other members and the study itself are untouched.
    expect(await studyIdsOf(stayer.memberId)).toEqual([study.id]);
    const row = await env.DB.prepare("SELECT count(*) AS n FROM studies WHERE id IN (?, ?)")
      .bind(study.id, ended.id)
      .first<{ n: number }>();
    expect(row?.n).toBe(2);
  });

  it("clears the stored Discord role IDs, so a study created later does not re-add the member", async () => {
    const roleId = newSnowflake();
    const admin = await login(app, { isAdmin: true });
    const leaver = await login(app, { roles: [roleId] });
    const before = await env.DB.prepare("SELECT discord_role_ids AS r FROM members WHERE id = ?")
      .bind(leaver.memberId)
      .first<{ r: string | null }>();
    expect(JSON.parse(before!.r!)).toEqual([roleId]);

    expect((await call(app, "DELETE", "/api/me", { cookie: leaver.cookie })).status).toBe(204);
    const after = await env.DB.prepare("SELECT discord_role_ids AS r FROM members WHERE id = ?")
      .bind(leaver.memberId)
      .first<{ r: string | null }>();
    expect(after?.r).toBeNull();

    const study = await createStudy(app, admin, { discordRoleId: roleId });
    expect(study.members).toEqual([]);
    expect(await studyIdsOf(leaver.memberId)).toEqual([]);
  });
});
