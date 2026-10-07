// Study membership = Discord role (PRD D-23, TSD TD-23): recomputed on login,
// on the 24h re-verification and on POST /api/me/refresh-roles.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { GuildMemberResult } from "../../src/worker/auth/discord";
import {
  call,
  countSessions,
  HOUR,
  insertStudy,
  login,
  makeApp,
  sessionCookieFrom,
  setVerifiedAt,
  stubDiscord,
  studyIdsOf,
} from "../helpers";

/** A Discord stub whose guild roles (or availability) the test can change. */
function rolesDiscord(initial: string[] = []) {
  const state = { roles: initial, unavailable: false };
  const discord = stubDiscord({
    getGuildMember: (): Promise<GuildMemberResult> =>
      Promise.resolve(
        state.unavailable
          ? { kind: "unavailable" }
          : { kind: "ok", member: { user: { id: "1", username: "member" }, nick: null, roles: state.roles } },
      ),
  });
  return { state, discord };
}

async function joinedAt(studyId: string, memberId: string): Promise<number | undefined> {
  const row = await env.DB.prepare("SELECT joined_at FROM study_members WHERE study_id = ? AND member_id = ?")
    .bind(studyId, memberId)
    .first<{ joined_at: number }>();
  return row?.joined_at;
}

describe("role sync on login (callback)", () => {
  it("study roles in the guild member object become study memberships", async () => {
    const a = await insertStudy({ name: "DDIA" });
    const b = await insertStudy({ name: "CKAD" });
    await insertStudy({ name: "다른 스터디" });
    const discordId = "770000000000000001";
    const discord = stubDiscord({
      getUser: () => Promise.resolve({ id: discordId, username: "u" }),
      getGuildMember: () =>
        Promise.resolve({
          kind: "ok",
          member: { user: { id: discordId, username: "u" }, nick: null, roles: [a.roleId, "999", b.roleId] },
        }),
    });
    const app = makeApp({ discord: () => discord });
    const start = await call(app, "GET", "/auth/login");
    const state = /j5_oauth_state=([^;]+)/.exec(start.headers.get("Set-Cookie") ?? "")![1]!;
    const res = await call(app, "GET", `/auth/callback?code=c&state=${state}`, { cookie: `j5_oauth_state=${state}` });
    expect(res.headers.get("Location")).toBe("/");
    const me = await call(app, "GET", "/api/me", { cookie: sessionCookieFrom(res) });
    expect(me.json.studies.map((s: { name: string }) => s.name).sort()).toEqual(["CKAD", "DDIA"]);
  });
});

describe("role sync on the 24h re-verification", () => {
  it("gaining a study role → member; losing it → removed", async () => {
    const study = await insertStudy();
    const { state, discord } = rolesDiscord();
    const app = makeApp({ discord: () => discord });
    const user = await login(app);
    expect(await studyIdsOf(user.memberId)).toEqual([]);

    state.roles = [study.roleId];
    await setVerifiedAt(user.memberId, Date.now() - 25 * HOUR);
    const me = await call(app, "GET", "/api/me", { cookie: user.cookie });
    expect(me.status).toBe(200);
    expect(me.json.studies).toEqual([{ id: study.id, name: expect.any(String), status: "active" }]);

    state.roles = [];
    await setVerifiedAt(user.memberId, Date.now() - 25 * HOUR);
    const after = await call(app, "GET", "/api/me", { cookie: user.cookie });
    expect(after.json.studies).toEqual([]);
    expect(await studyIdsOf(user.memberId)).toEqual([]);
  });

  it("only touches this member's rows and keeps joined_at for memberships that persist", async () => {
    const keep = await insertStudy();
    const drop = await insertStudy();
    const add = await insertStudy();
    const { state, discord } = rolesDiscord();
    const app = makeApp({ discord: () => discord });
    const user = await login(app, { roles: [keep.roleId, drop.roleId] });
    const other = await login(app, { roles: [drop.roleId] });
    await env.DB.prepare("UPDATE study_members SET joined_at = 1 WHERE member_id = ?").bind(user.memberId).run();

    state.roles = [keep.roleId, add.roleId];
    await setVerifiedAt(user.memberId, Date.now() - 25 * HOUR);
    expect((await call(app, "GET", "/api/me", { cookie: user.cookie })).status).toBe(200);
    expect(await studyIdsOf(user.memberId)).toEqual([keep.id, add.id].sort());
    expect(await joinedAt(keep.id, user.memberId)).toBe(1);
    expect(await joinedAt(add.id, user.memberId)).toBeGreaterThan(1);
    expect(await studyIdsOf(other.memberId)).toEqual([drop.id]);
  });
});

describe("POST /api/me/refresh-roles", () => {
  it("re-checks Discord now and returns the refreshed /api/me payload", async () => {
    const study = await insertStudy({ name: "AI Engineering" });
    const { state, discord } = rolesDiscord();
    const app = makeApp({ discord: () => discord });
    const user = await login(app, { displayName: "멤버" });
    state.roles = [study.roleId];

    const res = await call(app, "POST", "/api/me/refresh-roles", { cookie: user.cookie });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      id: user.memberId,
      displayName: "member",
      avatarUrl: expect.any(String),
      isAdmin: false,
      studies: [{ id: study.id, name: "AI Engineering", status: "active" }],
    });
    expect(discord.calls.filter((c) => c === "getGuildMember")).toHaveLength(1);

    // Losing the role is reflected too (after the rate-limit window).
    const later = makeApp({ discord: () => discord, now: () => Date.now() + 61_000 });
    state.roles = [];
    const removed = await call(later, "POST", "/api/me/refresh-roles", { cookie: user.cookie });
    expect(removed.status).toBe(200);
    expect(removed.json.studies).toEqual([]);
  });

  it("is limited to once per 60s per member (429 RATE_LIMITED with retryAfterSeconds)", async () => {
    const { discord } = rolesDiscord();
    let clock = Date.now();
    const app = makeApp({ discord: () => discord, now: () => clock });
    const user = await login(app);
    const other = await login(app);

    expect((await call(app, "POST", "/api/me/refresh-roles", { cookie: user.cookie })).status).toBe(200);
    clock += 20_000;
    const limited = await call(app, "POST", "/api/me/refresh-roles", { cookie: user.cookie });
    expect(limited.status).toBe(429);
    expect(limited.json.error).toEqual({ code: "RATE_LIMITED", message: expect.any(String), retryAfterSeconds: 40 });
    expect(limited.headers.get("Retry-After")).toBe("40");
    expect(discord.calls.filter((c) => c === "getGuildMember")).toHaveLength(1);

    // Per member: someone else is not limited.
    expect((await call(app, "POST", "/api/me/refresh-roles", { cookie: other.cookie })).status).toBe(200);

    clock += 40_000;
    expect((await call(app, "POST", "/api/me/refresh-roles", { cookie: user.cookie })).status).toBe(200);
  });

  it("Discord unavailable → 503 DISCORD_UNAVAILABLE, no grace, session kept", async () => {
    const { state, discord } = rolesDiscord();
    const app = makeApp({ discord: () => discord });
    const user = await login(app);
    state.unavailable = true;
    const res = await call(app, "POST", "/api/me/refresh-roles", { cookie: user.cookie });
    expect(res.status).toBe(503);
    expect(res.json.error.code).toBe("DISCORD_UNAVAILABLE");
    expect(await countSessions(user.memberId)).toBe(1);
    expect((await call(app, "GET", "/api/me", { cookie: user.cookie })).status).toBe(200);
  });

  it("left the guild → 401 NOT_GUILD_MEMBER and sessions revoked", async () => {
    const discord = stubDiscord({ getGuildMember: () => Promise.resolve({ kind: "not_member" }) });
    const app = makeApp({ discord: () => discord });
    const user = await login(app);
    const res = await call(app, "POST", "/api/me/refresh-roles", { cookie: user.cookie });
    expect(res.status).toBe(401);
    expect(res.json.error.code).toBe("NOT_GUILD_MEMBER");
    expect(await countSessions(user.memberId)).toBe(0);
  });

  it("does not ask Discord twice when the 24h check already ran in the same request", async () => {
    const study = await insertStudy();
    const { discord } = rolesDiscord([study.roleId]);
    const app = makeApp({ discord: () => discord });
    const user = await login(app);
    await setVerifiedAt(user.memberId, Date.now() - 25 * HOUR);
    const res = await call(app, "POST", "/api/me/refresh-roles", { cookie: user.cookie });
    expect(res.status).toBe(200);
    expect(res.json.studies).toEqual([expect.objectContaining({ id: study.id })]);
    expect(discord.calls.filter((c) => c === "getGuildMember")).toHaveLength(1);
  });
});
