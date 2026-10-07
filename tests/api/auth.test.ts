// Auth, middleware, CSRF, test-login gating, re-verification (TSD 6, 9.1, 9.5).
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../../src/worker/index";
import {
  ADMIN_ROLE_ID,
  call,
  countSessions,
  createPost,
  HOUR,
  login,
  makeApp,
  ORIGIN,
  sessionCookieFrom,
  setVerifiedAt,
  stubDiscord,
  uuidv7,
} from "../helpers";

const app = makeApp();

// Every /api route of M1 and M2. Each must be 401 without a session.
const API_ROUTES: [string, string][] = [
  ["GET", "/api/me"],
  ["DELETE", "/api/me"],
  ["POST", "/api/me/refresh-roles"],
  ["GET", "/api/home"],
  ["GET", "/api/categories"],
  ["POST", "/api/categories"],
  ["PATCH", `/api/categories/${uuidv7()}`],
  ["GET", "/api/posts"],
  ["POST", "/api/posts"],
  ["GET", `/api/posts/${uuidv7()}`],
  ["PATCH", `/api/posts/${uuidv7()}`],
  ["DELETE", `/api/posts/${uuidv7()}`],
  ["PUT", `/api/posts/${uuidv7()}/round`],
  ["POST", `/api/posts/${uuidv7()}/hide`],
  ["POST", `/api/posts/${uuidv7()}/unhide`],
  ["POST", `/api/posts/${uuidv7()}/comments`],
  ["POST", `/api/rounds/${uuidv7()}/comments`],
  ["PATCH", `/api/comments/${uuidv7()}`],
  ["DELETE", `/api/comments/${uuidv7()}`],
  ["POST", `/api/comments/${uuidv7()}/hide`],
  ["POST", `/api/comments/${uuidv7()}/unhide`],
  ["GET", "/api/me/linkable-rounds"],
  ["GET", "/api/studies"],
  ["POST", "/api/studies"],
  ["GET", `/api/studies/${uuidv7()}`],
  ["PATCH", `/api/studies/${uuidv7()}`],
  ["PUT", `/api/studies/${uuidv7()}/role`],
  ["POST", `/api/studies/${uuidv7()}/end`],
  ["POST", `/api/studies/${uuidv7()}/reopen`],
  ["POST", `/api/studies/${uuidv7()}/hide`],
  ["POST", `/api/studies/${uuidv7()}/unhide`],
  ["POST", `/api/studies/${uuidv7()}/rounds`],
  ["GET", `/api/rounds/${uuidv7()}`],
  ["PATCH", `/api/rounds/${uuidv7()}/info`],
  ["PATCH", `/api/rounds/${uuidv7()}/notes`],
  ["POST", `/api/rounds/${uuidv7()}/end`],
  ["POST", `/api/rounds/${uuidv7()}/reopen`],
  ["DELETE", `/api/rounds/${uuidv7()}`],
  ["GET", "/api/does-not-exist"],
];

describe("unauthenticated access (PRD F-01)", () => {
  it.each(API_ROUTES)("%s %s → 401", async (method, path) => {
    const res = await call(app, method, path, { body: method === "GET" ? undefined : {} });
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: { code: "UNAUTHENTICATED", message: expect.any(String) } });
  });

  it("an unknown session token → 401", async () => {
    const res = await call(app, "GET", "/api/me", { cookie: "j5_session=forged" });
    expect(res.status).toBe(401);
  });

  it("an expired session → 401", async () => {
    const user = await login(app);
    await env.DB.prepare("UPDATE auth_sessions SET expires_at = ? WHERE member_id = ?")
      .bind(Date.now() - 1, user.memberId)
      .run();
    expect((await call(app, "GET", "/api/me", { cookie: user.cookie })).status).toBe(401);
  });
});

describe("session cookie", () => {
  it("is HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=30d and only its hash is stored", async () => {
    const res = await call(app, "POST", "/auth/test-login", { body: { discordUserId: "31337" } });
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).toMatch(/Max-Age=2592000/);
    const raw = sessionCookieFrom(res).split("=")[1]!;
    expect(raw.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url
    const stored = await env.DB.prepare("SELECT token_hash FROM auth_sessions WHERE token_hash = ?")
      .bind(raw)
      .first();
    expect(stored).toBeNull();
  });

  it("Discord tokens are stored encrypted", async () => {
    const user = await login(app, { discordUserId: "424242" });
    const row = await env.DB.prepare("SELECT access_token_enc, refresh_token_enc FROM discord_tokens WHERE member_id = ?")
      .bind(user.memberId)
      .first<{ access_token_enc: string; refresh_token_enc: string }>();
    expect(row?.access_token_enc).toMatch(/^v1\./);
    expect(row?.access_token_enc).not.toContain("test-access");
    expect(row?.refresh_token_enc).not.toContain("test-refresh");
  });

  it("logout deletes the session", async () => {
    const user = await login(app);
    const res = await call(app, "POST", "/auth/logout", { cookie: user.cookie });
    expect(res.status).toBe(204);
    expect(await countSessions(user.memberId)).toBe(0);
    expect((await call(app, "GET", "/api/me", { cookie: user.cookie })).status).toBe(401);
  });
});

describe("guild membership", () => {
  it("a member flagged as not in the guild is blocked with NOT_GUILD_MEMBER", async () => {
    const user = await login(app);
    await env.DB.prepare("UPDATE members SET is_guild_member = 0 WHERE id = ?").bind(user.memberId).run();
    const res = await call(app, "GET", "/api/posts", { cookie: user.cookie });
    expect(res.status).toBe(401);
    expect(res.json.error.code).toBe("NOT_GUILD_MEMBER");
    const write = await call(app, "POST", "/api/categories", { cookie: user.cookie, body: { name: "차단" } });
    expect(write.status).toBe(401);
  });
});

describe("CSRF (TSD 6.2 step 4)", () => {
  it("rejects a mutating request without Origin", async () => {
    const user = await login(app);
    const res = await call(app, "POST", "/api/categories", { cookie: user.cookie, origin: null, body: { name: "x1" } });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe("FORBIDDEN");
  });

  it("rejects a mutating request from another origin", async () => {
    const user = await login(app);
    const res = await call(app, "DELETE", `/api/posts/${uuidv7()}`, { cookie: user.cookie, origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });

  it("rejects a non-JSON content type (form posts)", async () => {
    const user = await login(app);
    const res = await call(app, "POST", "/api/categories", {
      cookie: user.cookie,
      contentType: "application/x-www-form-urlencoded",
      body: { name: "x2" },
    });
    expect(res.status).toBe(403);
  });

  it("does not apply to GET", async () => {
    const user = await login(app);
    expect((await call(app, "GET", "/api/me", { cookie: user.cookie, origin: null })).status).toBe(200);
  });

  it("protects logout too", async () => {
    const user = await login(app);
    expect((await call(app, "POST", "/auth/logout", { cookie: user.cookie, origin: "https://evil.example" })).status).toBe(403);
    expect(await countSessions(user.memberId)).toBe(1);
  });
});

describe("test-login is registered only when ENV === test (TSD 9.1)", () => {
  it("createApp({ testLogin: false }) has no /auth/test-login", async () => {
    const prodApp = makeApp(undefined, false);
    const res = await call(prodApp, "POST", "/auth/test-login", { body: { discordUserId: "1" } });
    expect(res.status).toBe(404);
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("the Worker entry point with ENV=production has no /auth/test-login", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request(`${ORIGIN}/auth/test-login`, {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ discordUserId: "1" }),
      }),
      { ...env, ENV: "production" },
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("the Worker entry point with ENV=test exposes it", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request(`${ORIGIN}/auth/test-login`, {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ discordUserId: "777" }),
      }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
  });
});

describe("security headers (TSD 9.5)", () => {
  it.each([
    ["GET", "/api/me"],
    ["GET", "/"],
    ["GET", "/posts/some-spa-route"],
  ])("%s %s", async (method, path) => {
    const res = await call(app, method, path);
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(res.headers.get("Content-Security-Policy")).toContain("img-src 'self' https:");
    expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("serves the SPA shell for non-API paths", async () => {
    const res = await call(app, "GET", "/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("정글5");
  });
});

describe("OAuth login flow (TSD 6.1) with a stubbed DiscordClient", () => {
  async function startLogin(a: ReturnType<typeof makeApp>) {
    const res = await call(a, "GET", "/auth/login");
    expect(res.status).toBe(302);
    const state = /j5_oauth_state=([^;]+)/.exec(res.headers.get("Set-Cookie") ?? "")?.[1];
    expect(state).toBeTruthy();
    expect(res.headers.get("Location")).toContain(`state=${state}`);
    return state!;
  }

  it("rejects a state mismatch without creating a session", async () => {
    const discord = stubDiscord();
    const a = makeApp({ discord: () => discord });
    const state = await startLogin(a);
    const res = await call(a, "GET", `/auth/callback?code=c&state=wrong`, { cookie: `j5_oauth_state=${state}` });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login?error=invalid_state");
    expect(discord.calls).not.toContain("exchangeCode");
  });

  it("a non-member (404) gets no session", async () => {
    const discordId = "880000000000000001";
    const discord = stubDiscord({
      getUser: () => Promise.resolve({ id: discordId, username: "outsider" }),
      getGuildMember: () => Promise.resolve({ kind: "not_member" }),
    });
    const a = makeApp({ discord: () => discord });
    const state = await startLogin(a);
    const res = await call(a, "GET", `/auth/callback?code=c&state=${state}`, { cookie: `j5_oauth_state=${state}` });
    expect(res.headers.get("Location")).toBe("/login?error=not_member");
    expect(res.headers.get("Set-Cookie") ?? "").not.toMatch(/j5_session=[^;]/);
    const member = await env.DB.prepare("SELECT id FROM members WHERE discord_user_id = ?").bind(discordId).first();
    expect(member).toBeNull();
  });

  it("a guild member gets a session; admin role and name precedence (TD-20) are applied", async () => {
    const discordId = "880000000000000002";
    const discord = stubDiscord({
      getUser: () => Promise.resolve({ id: discordId, username: "uname", global_name: "Global" }),
      getGuildMember: () =>
        Promise.resolve({
          kind: "ok",
          member: { user: { id: discordId, username: "uname", global_name: "Global" }, nick: "Nick", roles: [ADMIN_ROLE_ID] },
        }),
    });
    const a = makeApp({ discord: () => discord });
    const state = await startLogin(a);
    const res = await call(a, "GET", `/auth/callback?code=c&state=${state}`, { cookie: `j5_oauth_state=${state}` });
    expect(res.headers.get("Location")).toBe("/");
    const me = await call(a, "GET", "/api/me", { cookie: sessionCookieFrom(res) });
    expect(me.status).toBe(200);
    expect(me.json).toMatchObject({ displayName: "Nick", isAdmin: true, studies: [] });
    expect(me.json.avatarUrl).toMatch(/^https:\/\/cdn\.discordapp\.com\//);
  });
});

describe("24h re-verification (TSD 6.3) with a stubbed DiscordClient", () => {
  it("does not call Discord when verified within 24h", async () => {
    const discord = stubDiscord();
    const a = makeApp({ discord: () => discord });
    const user = await login(a);
    await setVerifiedAt(user.memberId, Date.now() - 23 * HOUR);
    expect((await call(a, "GET", "/api/me", { cookie: user.cookie })).status).toBe(200);
    expect(discord.calls).toEqual([]);
  });

  it("not a member any more (404) → is_guild_member=0, all sessions revoked, 401 NOT_GUILD_MEMBER", async () => {
    const discord = stubDiscord({ getGuildMember: () => Promise.resolve({ kind: "not_member" }) });
    const a = makeApp({ discord: () => discord });
    const user = await login(a);
    const second = await login(a, { discordUserId: user.discordUserId }); // another device
    await setVerifiedAt(user.memberId, Date.now() - 25 * HOUR);
    const res = await call(a, "GET", "/api/me", { cookie: user.cookie });
    expect(res.status).toBe(401);
    expect(res.json.error.code).toBe("NOT_GUILD_MEMBER");
    expect(await countSessions(user.memberId)).toBe(0);
    expect((await call(a, "GET", "/api/me", { cookie: second.cookie })).status).toBe(401);
    const row = await env.DB.prepare("SELECT is_guild_member FROM members WHERE id = ?")
      .bind(user.memberId)
      .first<{ is_guild_member: number }>();
    expect(row?.is_guild_member).toBe(0);
  });

  it("Discord outage (5xx) within 72h of the last success → allowed, retried next request", async () => {
    const discord = stubDiscord({ getGuildMember: () => Promise.resolve({ kind: "unavailable" }) });
    const a = makeApp({ discord: () => discord });
    const user = await login(a);
    const verifiedAt = Date.now() - 48 * HOUR;
    await setVerifiedAt(user.memberId, verifiedAt);
    expect((await call(a, "GET", "/api/me", { cookie: user.cookie })).status).toBe(200);
    expect((await call(a, "GET", "/api/me", { cookie: user.cookie })).status).toBe(200);
    expect(discord.calls.filter((c) => c === "getGuildMember")).toHaveLength(2);
    const row = await env.DB.prepare("SELECT verified_at FROM members WHERE id = ?")
      .bind(user.memberId)
      .first<{ verified_at: number }>();
    expect(row?.verified_at).toBe(verifiedAt);
  });

  it("Discord outage beyond 72h → 401", async () => {
    const discord = stubDiscord({ getGuildMember: () => Promise.resolve({ kind: "unavailable" }) });
    const a = makeApp({ discord: () => discord });
    const user = await login(a);
    await setVerifiedAt(user.memberId, Date.now() - 73 * HOUR);
    const res = await call(a, "GET", "/api/me", { cookie: user.cookie });
    expect(res.status).toBe(401);
    expect(res.json.error.code).toBe("UNAUTHENTICATED");
  });

  it("success refreshes is_admin, display name and verified_at", async () => {
    const discord = stubDiscord({
      getGuildMember: () =>
        Promise.resolve({
          kind: "ok",
          member: { user: { id: "1", username: "renamed" }, nick: null, roles: [ADMIN_ROLE_ID] },
        }),
    });
    const a = makeApp({ discord: () => discord });
    const user = await login(a, { isAdmin: false });
    await setVerifiedAt(user.memberId, Date.now() - 25 * HOUR);
    const me = await call(a, "GET", "/api/me", { cookie: user.cookie });
    expect(me.status).toBe(200);
    expect(me.json).toMatchObject({ isAdmin: true, displayName: "renamed" });
    const row = await env.DB.prepare("SELECT verified_at FROM members WHERE id = ?")
      .bind(user.memberId)
      .first<{ verified_at: number }>();
    expect(row!.verified_at).toBeGreaterThan(Date.now() - HOUR);
  });

  it("expired access token + refresh rejected → sessions revoked, 401", async () => {
    const discord = stubDiscord({ refresh: () => Promise.resolve({ kind: "invalid" }) });
    const a = makeApp({ discord: () => discord });
    const user = await login(a);
    await setVerifiedAt(user.memberId, Date.now() - 25 * HOUR);
    await env.DB.prepare("UPDATE discord_tokens SET access_expires_at = ? WHERE member_id = ?")
      .bind(Date.now() - 1, user.memberId)
      .run();
    const res = await call(a, "GET", "/api/me", { cookie: user.cookie });
    expect(res.status).toBe(401);
    expect(discord.calls).toEqual(["refresh"]);
    expect(await countSessions(user.memberId)).toBe(0);
  });

  it("access token rejected (401) → refresh once and retry", async () => {
    let first = true;
    const discord = stubDiscord({
      getGuildMember: () => {
        if (first) {
          first = false;
          return Promise.resolve({ kind: "unauthorized" });
        }
        return Promise.resolve({ kind: "ok", member: { user: { id: "1", username: "ok" }, roles: [] } });
      },
    });
    const a = makeApp({ discord: () => discord });
    const user = await login(a);
    await setVerifiedAt(user.memberId, Date.now() - 25 * HOUR);
    expect((await call(a, "GET", "/api/me", { cookie: user.cookie })).status).toBe(200);
    expect(discord.calls).toEqual(["getGuildMember", "refresh", "getGuildMember"]);
  });

  it("refresh rejected after a 401 → sessions revoked", async () => {
    const discord = stubDiscord({
      getGuildMember: () => Promise.resolve({ kind: "unauthorized" }),
      refresh: () => Promise.resolve({ kind: "invalid" }),
    });
    const a = makeApp({ discord: () => discord });
    const user = await login(a);
    await setVerifiedAt(user.memberId, Date.now() - 25 * HOUR);
    expect((await call(a, "GET", "/api/me", { cookie: user.cookie })).status).toBe(401);
    expect(await countSessions(user.memberId)).toBe(0);
  });
});

describe("M2 routes are live", () => {
  it("no route answers 501 NOT_IMPLEMENTED any more", async () => {
    const user = await login(app);
    const post = await createPost(app, user);
    const list = await call(app, "GET", "/api/studies", { cookie: user.cookie });
    expect(list.status).toBe(200);
    expect(list.json).toEqual({ items: expect.any(Array) });
    const unlink = await call(app, "PUT", `/api/posts/${post.id}/round`, { cookie: user.cookie, body: { roundId: null } });
    expect(unlink.status).toBe(200);
    expect((await call(app, "GET", `/api/rounds/${uuidv7()}`, { cookie: user.cookie })).status).toBe(404);
  });
});
