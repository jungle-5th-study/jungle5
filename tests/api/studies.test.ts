// Studies (PRD F-05, D-23, D-24; TSD 7.1, TD-14, TD-23 + 3.2 M2 rows).
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { GuildMemberResult } from "../../src/worker/auth/discord";
import {
  call,
  createRound,
  createStudy,
  HOUR,
  login,
  makeApp,
  newSnowflake,
  setVerifiedAt,
  stubDiscord,
  studyIdsOf,
  studyInput,
  studySetup,
  uuidv7,
} from "../helpers";

const app = makeApp();

async function memberIdsOf(studyId: string): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT member_id FROM study_members WHERE study_id = ? ORDER BY member_id")
    .bind(studyId)
    .all<{ member_id: string }>();
  return results.map((r) => r.member_id);
}

describe("POST /api/studies", () => {
  it("admin only: community members and study members get 403", async () => {
    const roleId = newSnowflake();
    const member = await login(app);
    const roleHolder = await login(app, { roles: [roleId] });
    for (const u of [member, roleHolder]) {
      const res = await call(app, "POST", "/api/studies", { cookie: u.cookie, body: studyInput({ discordRoleId: roleId }) });
      expect(res.status).toBe(403);
      expect(res.json.error.code).toBe("FORBIDDEN");
    }
  });

  it("creates a study with all fields and returns the detail (201)", async () => {
    const admin = await login(app, { isAdmin: true });
    const input = studyInput({
      name: "DDIA",
      goal: "완독",
      description: "# 설명",
      materials: "- 책",
      cadence: "매주 목 21시",
      joinGuide: "#ddia 채널에서 역할 요청",
    });
    const res = await call(app, "POST", "/api/studies", { cookie: admin.cookie, body: input });
    expect(res.status).toBe(201);
    expect(res.json).toEqual({
      id: input.id,
      name: "DDIA",
      goal: "완독",
      description: "# 설명",
      materials: "- 책",
      cadence: "매주 목 21시",
      joinGuide: "#ddia 채널에서 역할 요청",
      discordRoleId: input.discordRoleId,
      status: "active",
      hidden: false,
      version: 1,
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
      isMember: false,
      members: [],
      rounds: [],
      permissions: { canEdit: true, canCreateRound: true, canManage: true },
    });
    // Replay with the same id (TD-13) → 200 and the same study.
    const again = await call(app, "POST", "/api/studies", { cookie: admin.cookie, body: input });
    expect(again.status).toBe(200);
    expect(again.json.id).toBe(input.id);
  });

  it("validates required fields and the Discord role id (17–20 digits)", async () => {
    const admin = await login(app, { isAdmin: true });
    const bad = [
      [{ name: "" }, "name"],
      [{ goal: "  " }, "goal"],
      [{ discordRoleId: undefined }, "discordRoleId"],
      [{ discordRoleId: "1234" }, "discordRoleId"],
      [{ discordRoleId: "123456789012345678901" }, "discordRoleId"],
      [{ discordRoleId: "12345678901234567a" }, "discordRoleId"],
      [{ id: "not-a-uuid" }, "id"],
    ] as const;
    for (const [override, field] of bad) {
      const res = await call(app, "POST", "/api/studies", { cookie: admin.cookie, body: studyInput(override) });
      expect(res.status, JSON.stringify(override)).toBe(422);
      expect(res.json.error.fields[field]).toBeDefined();
    }
    for (const ok of ["12345678901234567", "12345678901234567890"]) {
      const res = await call(app, "POST", "/api/studies", { cookie: admin.cookie, body: studyInput({ discordRoleId: ok }) });
      expect(res.status).toBe(201);
    }
  });

  it("a role already linked to another study → 409 DUPLICATE with that study", async () => {
    const admin = await login(app, { isAdmin: true });
    const first = await createStudy(app, admin, { name: "첫 스터디" });
    const res = await call(app, "POST", "/api/studies", {
      cookie: admin.cookie,
      body: studyInput({ discordRoleId: first.discordRoleId }),
    });
    expect(res.status).toBe(409);
    expect(res.json.error).toEqual({
      code: "DUPLICATE",
      message: expect.any(String),
      existing: { id: first.id, name: "첫 스터디" },
    });
  });

  it("members are computed immediately from the role IDs stored at their last check", async () => {
    const roleId = newSnowflake();
    const admin = await login(app, { isAdmin: true });
    const holder = await login(app, { roles: ["999", roleId] });
    const holder2 = await login(app, { roles: [roleId] });
    const other = await login(app, { roles: ["999"] });
    const leaver = await login(app, { roles: [roleId] });
    expect((await call(app, "DELETE", "/api/me", { cookie: leaver.cookie })).status).toBe(204);
    const gone = await login(app, { roles: [roleId] });
    await env.DB.prepare("UPDATE members SET is_guild_member = 0 WHERE id = ?").bind(gone.memberId).run();

    const study = await createStudy(app, admin, { discordRoleId: roleId });
    expect(await memberIdsOf(study.id)).toEqual([holder.memberId, holder2.memberId].sort());
    expect(study.members.map((m: { id: string }) => m.id).sort()).toEqual([holder.memberId, holder2.memberId].sort());
    expect(await studyIdsOf(other.memberId)).toEqual([]);

    // The holder can work in it right away, without a refresh.
    const me = await call(app, "GET", "/api/me", { cookie: holder.cookie });
    expect(me.json.studies).toEqual([{ id: study.id, name: study.name, status: "active" }]);
    const detail = await call(app, "GET", `/api/studies/${study.id}`, { cookie: holder.cookie });
    expect(detail.json.isMember).toBe(true);
    expect(detail.json.permissions).toEqual({ canEdit: true, canCreateRound: true, canManage: false });
  });

  it("members not checked since migration 0002 (NULL role ids) join at their next check", async () => {
    const roleId = newSnowflake();
    const admin = await login(app, { isAdmin: true });
    const legacy = await login(app, { roles: [roleId] });
    await env.DB.prepare("UPDATE members SET discord_role_ids = NULL WHERE id = ?").bind(legacy.memberId).run();
    const study = await createStudy(app, admin, { discordRoleId: roleId });
    expect(await memberIdsOf(study.id)).toEqual([]);
    await login(app, { discordUserId: legacy.discordUserId, roles: [roleId] });
    expect(await memberIdsOf(study.id)).toEqual([legacy.memberId]);
  });
});

describe("PUT /api/studies/:id/role", () => {
  it("admin changes the role; members are recomputed (old holders out, new holders in, joined_at kept)", async () => {
    const oldRole = newSnowflake();
    const newRole = newSnowflake();
    const admin = await login(app, { isAdmin: true });
    const both = await login(app, { roles: [oldRole, newRole] });
    const oldOnly = await login(app, { roles: [oldRole] });
    const newOnly = await login(app, { roles: [newRole] });
    const study = await createStudy(app, admin, { discordRoleId: oldRole });
    expect(await memberIdsOf(study.id)).toEqual([both.memberId, oldOnly.memberId].sort());
    await env.DB.prepare("UPDATE study_members SET joined_at = 1 WHERE study_id = ?").bind(study.id).run();

    const res = await call(app, "PUT", `/api/studies/${study.id}/role`, {
      cookie: admin.cookie,
      body: { discordRoleId: newRole },
    });
    expect(res.status).toBe(200);
    expect(res.json.discordRoleId).toBe(newRole);
    expect(await memberIdsOf(study.id)).toEqual([both.memberId, newOnly.memberId].sort());
    const kept = await env.DB.prepare("SELECT joined_at FROM study_members WHERE study_id = ? AND member_id = ?")
      .bind(study.id, both.memberId)
      .first<{ joined_at: number }>();
    expect(kept?.joined_at).toBe(1);

    // Later Discord checks use the new role as well.
    const relog = await login(app, { discordUserId: oldOnly.discordUserId, roles: [oldRole] });
    expect(await studyIdsOf(relog.memberId)).toEqual([]);
  });

  it("non-admins → 403 (study members too); a taken role → 409 DUPLICATE; bad id → 422", async () => {
    const { admin, member, study } = await studySetup(app);
    const other = await createStudy(app, admin, { name: "다른 스터디" });
    const forbidden = await call(app, "PUT", `/api/studies/${study.id}/role`, {
      cookie: member.cookie,
      body: { discordRoleId: newSnowflake() },
    });
    expect(forbidden.status).toBe(403);
    const taken = await call(app, "PUT", `/api/studies/${study.id}/role`, {
      cookie: admin.cookie,
      body: { discordRoleId: other.discordRoleId },
    });
    expect(taken.status).toBe(409);
    expect(taken.json.error).toMatchObject({ code: "DUPLICATE", existing: { id: other.id, name: "다른 스터디" } });
    const bad = await call(app, "PUT", `/api/studies/${study.id}/role`, { cookie: admin.cookie, body: { discordRoleId: "x" } });
    expect(bad.status).toBe(422);
    // Setting the same role again is fine.
    const same = await call(app, "PUT", `/api/studies/${study.id}/role`, {
      cookie: admin.cookie,
      body: { discordRoleId: study.discordRoleId },
    });
    expect(same.status).toBe(200);
    expect(same.json.members.map((m: { id: string }) => m.id)).toEqual([member.memberId]);
  });
});

describe("role IDs are stored at every Discord check (members.discord_role_ids)", () => {
  const storedRoles = async (memberId: string) =>
    (
      await env.DB.prepare("SELECT discord_role_ids AS r FROM members WHERE id = ?")
        .bind(memberId)
        .first<{ r: string | null }>()
    )?.r;

  it("login, the 24h re-verification and refresh-roles all update them", async () => {
    const state = { roles: ["111"] };
    const discord = stubDiscord({
      getGuildMember: (): Promise<GuildMemberResult> =>
        Promise.resolve({ kind: "ok", member: { user: { id: "1", username: "u" }, nick: null, roles: state.roles } }),
    });
    const a = makeApp({ discord: () => discord });
    const user = await login(a, { roles: ["100", "200"] });
    expect(JSON.parse((await storedRoles(user.memberId))!)).toEqual(["100", "200"]);

    await setVerifiedAt(user.memberId, Date.now() - 25 * HOUR);
    expect((await call(a, "GET", "/api/me", { cookie: user.cookie })).status).toBe(200);
    expect(JSON.parse((await storedRoles(user.memberId))!)).toEqual(["111"]);

    state.roles = ["222"];
    expect((await call(a, "POST", "/api/me/refresh-roles", { cookie: user.cookie })).status).toBe(200);
    expect(JSON.parse((await storedRoles(user.memberId))!)).toEqual(["222"]);
  });
});

describe("PATCH /api/studies/:id (TD-14 version)", () => {
  it("study members and admins edit; others 403; ended studies stay editable (D-24)", async () => {
    const { admin, member, outsider, study } = await studySetup(app);
    const r1 = await call(app, "PATCH", `/api/studies/${study.id}`, {
      cookie: member.cookie,
      body: { version: 1, goal: "2회독", description: "새 설명", cadence: "" },
    });
    expect(r1.status).toBe(200);
    expect(r1.json).toMatchObject({ goal: "2회독", description: "새 설명", cadence: null, version: 2 });
    const r2 = await call(app, "PATCH", `/api/studies/${study.id}`, {
      cookie: admin.cookie,
      body: { version: 2, name: "새 이름", joinGuide: "가이드" },
    });
    expect(r2.status).toBe(200);
    expect(r2.json).toMatchObject({ name: "새 이름", goal: "2회독", joinGuide: "가이드", version: 3 });
    const denied = await call(app, "PATCH", `/api/studies/${study.id}`, {
      cookie: outsider.cookie,
      body: { version: 3, goal: "탈취" },
    });
    expect(denied.status).toBe(403);

    expect((await call(app, "POST", `/api/studies/${study.id}/end`, { cookie: admin.cookie })).status).toBe(200);
    const onEnded = await call(app, "PATCH", `/api/studies/${study.id}`, {
      cookie: member.cookie,
      body: { version: 3, materials: "자료" },
    });
    expect(onEnded.status).toBe(200);
    expect(onEnded.json.materials).toBe("자료");
  });

  it("a stale version → 409 VERSION_CONFLICT with the latest study, nothing overwritten", async () => {
    const { admin, member, study } = await studySetup(app);
    const first = await call(app, "PATCH", `/api/studies/${study.id}`, {
      cookie: admin.cookie,
      body: { version: 1, goal: "먼저 저장" },
    });
    expect(first.status).toBe(200);
    const stale = await call(app, "PATCH", `/api/studies/${study.id}`, {
      cookie: member.cookie,
      body: { version: 1, goal: "늦은 저장", description: "덮어쓰기" },
    });
    expect(stale.status).toBe(409);
    expect(stale.json.error).toMatchObject({
      code: "VERSION_CONFLICT",
      latest: { id: study.id, goal: "먼저 저장", description: null, version: 2 },
    });
    const row = await env.DB.prepare("SELECT goal, description, version FROM studies WHERE id = ?").bind(study.id).first();
    expect(row).toEqual({ goal: "먼저 저장", description: null, version: 2 });
  });

  it("requires version; required fields cannot be cleared", async () => {
    const { member, study } = await studySetup(app);
    expect((await call(app, "PATCH", `/api/studies/${study.id}`, { cookie: member.cookie, body: { goal: "x" } })).status).toBe(422);
    const cleared = await call(app, "PATCH", `/api/studies/${study.id}`, { cookie: member.cookie, body: { version: 1, goal: "" } });
    expect(cleared.status).toBe(422);
    expect(cleared.json.error.fields.goal).toBeDefined();
  });
});

describe("end / reopen (admin)", () => {
  it("admin ends and reopens; members get 403; ended study blocks round creation (409 STUDY_ENDED)", async () => {
    const { admin, member, study } = await studySetup(app);
    expect((await call(app, "POST", `/api/studies/${study.id}/end`, { cookie: member.cookie })).status).toBe(403);
    const ended = await call(app, "POST", `/api/studies/${study.id}/end`, { cookie: admin.cookie });
    expect(ended.status).toBe(200);
    expect(ended.json).toMatchObject({ status: "ended", permissions: { canCreateRound: false, canEdit: true } });

    const blocked = await call(app, "POST", `/api/studies/${study.id}/rounds`, {
      cookie: member.cookie,
      body: { id: uuidv7(), title: "t", scope: "s", goal: "g" },
    });
    expect(blocked.status).toBe(409);
    expect(blocked.json.error.code).toBe("STUDY_ENDED");

    expect((await call(app, "POST", `/api/studies/${study.id}/reopen`, { cookie: member.cookie })).status).toBe(403);
    const reopened = await call(app, "POST", `/api/studies/${study.id}/reopen`, { cookie: admin.cookie });
    expect(reopened.status).toBe(200);
    expect(reopened.json.status).toBe("active");
    await createRound(app, member, study.id);
  });
});

describe("hidden studies (admin only)", () => {
  it("hidden studies are 404 / excluded for everyone but admins, members included", async () => {
    const { admin, member, outsider, study } = await studySetup(app);
    const round = await createRound(app, member, study.id);
    expect((await call(app, "POST", `/api/studies/${study.id}/hide`, { cookie: member.cookie })).status).toBe(403);
    expect((await call(app, "POST", `/api/studies/${study.id}/hide`, { cookie: admin.cookie })).status).toBe(204);

    for (const u of [member, outsider]) {
      expect((await call(app, "GET", `/api/studies/${study.id}`, { cookie: u.cookie })).status).toBe(404);
      expect((await call(app, "GET", `/api/rounds/${round.id}`, { cookie: u.cookie })).status).toBe(404);
      const list = await call(app, "GET", "/api/studies", { cookie: u.cookie });
      expect(list.json.items.map((s: { id: string }) => s.id)).not.toContain(study.id);
      const comment = await call(app, "POST", `/api/rounds/${round.id}/comments`, {
        cookie: u.cookie,
        body: { id: uuidv7(), body: "x" },
      });
      expect(comment.status).toBe(404);
    }
    const me = await call(app, "GET", "/api/me", { cookie: member.cookie });
    expect(me.json.studies).toEqual([]);
    const linkable = await call(app, "GET", "/api/me/linkable-rounds", { cookie: member.cookie });
    expect(linkable.json.items).toEqual([]);

    const asAdmin = await call(app, "GET", `/api/studies/${study.id}`, { cookie: admin.cookie });
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.json.hidden).toBe(true);
    const adminList = await call(app, "GET", "/api/studies", { cookie: admin.cookie });
    expect(adminList.json.items.find((s: { id: string }) => s.id === study.id)).toMatchObject({ hidden: true });

    expect((await call(app, "POST", `/api/studies/${study.id}/unhide`, { cookie: admin.cookie })).status).toBe(204);
    expect((await call(app, "GET", `/api/studies/${study.id}`, { cookie: member.cookie })).status).toBe(200);
    expect((await call(app, "POST", `/api/studies/${uuidv7()}/hide`, { cookie: admin.cookie })).status).toBe(404);
  });
});

describe("GET /api/studies and /api/studies/:id", () => {
  it("lists my studies first, then other active, then ended; with counts, rounds and next meeting", async () => {
    const clock = Date.now();
    const a = makeApp({ now: () => clock });
    const admin = await login(a, { isAdmin: true });
    const roleMine = newSnowflake();
    const roleMineEnded = newSnowflake();
    const me = await login(a, { roles: [roleMine, roleMineEnded] });
    const peer = await login(a, { roles: [roleMine] });
    const prefix = `z${clock}`;
    const other = await createStudy(a, admin, { name: `${prefix} 가 다른` });
    const mine = await createStudy(a, admin, { name: `${prefix} 나 내것`, discordRoleId: roleMine });
    const endedOther = await createStudy(a, admin, { name: `${prefix} 다 끝남` });
    const endedMine = await createStudy(a, admin, { name: `${prefix} 라 내끝남`, discordRoleId: roleMineEnded });
    await call(a, "POST", `/api/studies/${endedOther.id}/end`, { cookie: admin.cookie });
    await call(a, "POST", `/api/studies/${endedMine.id}/end`, { cookie: admin.cookie });

    const r1 = await createRound(a, me, mine.id, { title: "지난", meetingAt: clock - HOUR });
    const r2 = await createRound(a, peer, mine.id, { title: "다음", meetingAt: clock + 2 * HOUR });
    const r3 = await createRound(a, me, mine.id, { title: "다다음", meetingAt: clock + 48 * HOUR });

    const res = await call(a, "GET", "/api/studies", { cookie: me.cookie });
    expect(res.status).toBe(200);
    const ours = res.json.items.filter((s: { name: string }) => s.name.startsWith(prefix));
    expect(ours.map((s: { id: string }) => s.id)).toEqual([mine.id, other.id, endedMine.id, endedOther.id]);
    expect(ours[0]).toEqual({
      id: mine.id,
      name: `${prefix} 나 내것`,
      goal: "완독",
      cadence: null,
      status: "active",
      hidden: false,
      isMember: true,
      memberCount: 2,
      latestRound: { id: r3.id, seq: 3, title: "다다음", meetingAt: clock + 48 * HOUR, status: "active" },
      nextMeeting: { id: r2.id, seq: 2, title: "다음", meetingAt: clock + 2 * HOUR, status: "active" },
    });
    expect(ours[1]).toMatchObject({ isMember: false, memberCount: 0, latestRound: null, nextMeeting: null });

    const endedOnly = await call(a, "GET", "/api/studies?status=ended", { cookie: me.cookie });
    expect(endedOnly.json.items.every((s: { status: string }) => s.status === "ended")).toBe(true);
    expect((await call(a, "GET", "/api/studies?status=bogus", { cookie: me.cookie })).status).toBe(422);

    const detail = await call(a, "GET", `/api/studies/${mine.id}`, { cookie: peer.cookie });
    expect(detail.status).toBe(200);
    expect(detail.json.members.map((m: { id: string }) => m.id).sort()).toEqual([me.memberId, peer.memberId].sort());
    expect(detail.json.members[0]).toEqual({ id: expect.any(String), displayName: expect.any(String), avatarUrl: expect.any(String), withdrawn: false });
    expect(detail.json.rounds).toEqual([
      { id: r1.id, seq: 1, title: "지난", meetingAt: clock - HOUR, status: "active" },
      { id: r2.id, seq: 2, title: "다음", meetingAt: clock + 2 * HOUR, status: "active" },
      { id: r3.id, seq: 3, title: "다다음", meetingAt: clock + 48 * HOUR, status: "active" },
    ]);

    // Non-members read everything (incl. the join guide) but cannot edit.
    const outsider = await login(a);
    const asOutsider = await call(a, "GET", `/api/studies/${mine.id}`, { cookie: outsider.cookie });
    expect(asOutsider.json).toMatchObject({
      isMember: false,
      joinGuide: null,
      permissions: { canEdit: false, canCreateRound: false, canManage: false },
    });
    expect((await call(a, "GET", `/api/studies/${uuidv7()}`, { cookie: outsider.cookie })).status).toBe(404);
  });
});
