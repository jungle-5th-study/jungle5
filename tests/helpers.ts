/* Test helpers: an in-process app bound to the real (local) D1, test login, and a Discord stub. */
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { uuidv7 } from "../src/shared/ids";
import { createApp, type App } from "../src/worker/app";
import type { DiscordClient, GuildMemberResult } from "../src/worker/auth/discord";
import type { AppDeps } from "../src/worker/types";

export const ORIGIN = env.APP_ORIGIN;
export const GUILD_ID = env.DISCORD_GUILD_ID;
export const ADMIN_ROLE_ID = env.DISCORD_ADMIN_ROLE_ID;
export const SEED_CATEGORY_ID = "01900000-0000-7000-8000-000000000001";
export { uuidv7 };

export function makeApp(deps?: Partial<AppDeps>, testLogin = true): App {
  return createApp({ testLogin, deps });
}

export interface CallOptions {
  cookie?: string;
  body?: unknown;
  /** null = omit the header */
  origin?: string | null;
  /** null = omit the header */
  contentType?: string | null;
  env?: Partial<Env>;
}

export interface CallResult {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
  text: string;
  headers: Headers;
}

export async function call(app: App, method: string, path: string, opts: CallOptions = {}): Promise<CallResult> {
  const headers = new Headers();
  if (opts.cookie) headers.set("Cookie", opts.cookie);
  const origin = opts.origin === undefined ? ORIGIN : opts.origin;
  if (origin) headers.set("Origin", origin);
  const contentType = opts.contentType === undefined ? "application/json" : opts.contentType;
  if (contentType && method !== "GET") headers.set("Content-Type", contentType);
  const ctx = createExecutionContext();
  const res = await app.request(
    `${ORIGIN}${path}`,
    { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) },
    { ...env, ...opts.env },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, json, text, headers: res.headers };
}

export function sessionCookieFrom(res: CallResult): string {
  const setCookie = res.headers.get("Set-Cookie") ?? "";
  const match = /j5_session=([^;]+)/.exec(setCookie);
  if (!match?.[1]) throw new Error(`no session cookie in: ${setCookie}`);
  return `j5_session=${match[1]}`;
}

export interface TestUser {
  cookie: string;
  memberId: string;
  discordUserId: string;
}

let userSeq = 0;
export async function login(
  app: App,
  opts: { discordUserId?: string; displayName?: string; isAdmin?: boolean; roles?: string[] } = {},
): Promise<TestUser> {
  const discordUserId = opts.discordUserId ?? `9${Date.now()}${++userSeq}`.slice(0, 19);
  const res = await call(app, "POST", "/auth/test-login", {
    body: { discordUserId, displayName: opts.displayName, isAdmin: opts.isAdmin, roles: opts.roles },
  });
  if (res.status !== 200) throw new Error(`test-login failed: ${res.status} ${res.text}`);
  return { cookie: sessionCookieFrom(res), memberId: res.json.memberId as string, discordUserId };
}

export function postInput(overrides: Record<string, unknown> = {}) {
  return {
    id: uuidv7(),
    title: "테스트 글",
    body: "본문입니다",
    categoryId: SEED_CATEGORY_ID,
    ...overrides,
  };
}

export async function createPost(app: App, user: TestUser, overrides: Record<string, unknown> = {}) {
  const res = await call(app, "POST", "/api/posts", { cookie: user.cookie, body: postInput(overrides) });
  if (res.status !== 201) throw new Error(`create post failed: ${res.status} ${res.text}`);
  return res.json as { id: string; [k: string]: unknown };
}

export type StubDiscord = DiscordClient & { calls: string[] };

/** A DiscordClient without network. Override the pieces a test cares about. */
export function stubDiscord(overrides: Partial<DiscordClient> = {}): StubDiscord {
  const calls: string[] = [];
  const okMember: GuildMemberResult = {
    kind: "ok",
    member: { user: { id: "1", username: "user1" }, nick: null, roles: [] },
  };
  const base: DiscordClient = {
    authorizeUrl: (state, redirectUri) => `https://discord.test/authorize?state=${state}&redirect_uri=${redirectUri}`,
    exchangeCode: () => Promise.resolve({ accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3_600_000 }),
    refresh: () =>
      Promise.resolve({
        kind: "ok",
        tokens: { accessToken: "a2", refreshToken: "r2", expiresAt: Date.now() + 3_600_000 },
      }),
    getUser: () => Promise.resolve({ id: "1", username: "user1" }),
    getGuildMember: () => Promise.resolve(okMember),
  };
  const merged = { ...base, ...overrides };
  return {
    calls,
    authorizeUrl: (...a) => (calls.push("authorizeUrl"), merged.authorizeUrl(...a)),
    exchangeCode: (...a) => (calls.push("exchangeCode"), merged.exchangeCode(...a)),
    refresh: (...a) => (calls.push("refresh"), merged.refresh(...a)),
    getUser: (...a) => (calls.push("getUser"), merged.getUser(...a)),
    getGuildMember: (...a) => (calls.push("getGuildMember"), merged.getGuildMember(...a)),
  };
}

export const HOUR = 60 * 60 * 1000;

export async function setVerifiedAt(memberId: string, verifiedAt: number) {
  await env.DB.prepare("UPDATE members SET verified_at = ? WHERE id = ?").bind(verifiedAt, memberId).run();
}

export async function countSessions(memberId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT count(*) AS n FROM auth_sessions WHERE member_id = ?")
    .bind(memberId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

let roleSeq = 0;
/** A unique fake Discord role ID (snowflake-like). */
export const newRoleId = () => `3${Date.now()}${++roleSeq}`.slice(0, 19);

/** Inserts a study linked to a Discord role (no study API until M2). */
export async function insertStudy(opts: { name?: string; roleId?: string; status?: "active" | "ended" } = {}) {
  const id = uuidv7();
  const roleId = opts.roleId ?? newRoleId();
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO studies (id, name, goal, status, discord_role_id, version, created_at, updated_at) VALUES (?, ?, 'g', ?, ?, 1, ?, ?)",
  )
    .bind(id, opts.name ?? `스터디${roleSeq}`, opts.status ?? "active", roleId, now, now)
    .run();
  return { id, roleId };
}

export async function studyIdsOf(memberId: string): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT study_id FROM study_members WHERE member_id = ? ORDER BY study_id")
    .bind(memberId)
    .all<{ study_id: string }>();
  return results.map((r) => r.study_id);
}

/** A Discord role ID that passes the snowflake check (17–20 digits). */
export const newSnowflake = () => `4${Date.now()}${String(++roleSeq).padStart(4, "0")}`.slice(0, 19);

export function studyInput(overrides: Record<string, unknown> = {}) {
  return {
    id: uuidv7(),
    name: `스터디 ${roleSeq + 1}`,
    goal: "완독",
    discordRoleId: newSnowflake(),
    ...overrides,
  };
}

/** POST /api/studies as `admin` (must be an admin). */
export async function createStudy(app: App, admin: TestUser, overrides: Record<string, unknown> = {}) {
  const res = await call(app, "POST", "/api/studies", { cookie: admin.cookie, body: studyInput(overrides) });
  if (res.status !== 201) throw new Error(`create study failed: ${res.status} ${res.text}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return res.json as { id: string; discordRoleId: string; version: number; [k: string]: any };
}

export function roundInput(overrides: Record<string, unknown> = {}) {
  return { id: uuidv7(), title: "1장", scope: "1~3장", goal: "개념 이해", ...overrides };
}

/** POST /api/studies/:id/rounds as `user`. */
export async function createRound(app: App, user: TestUser, studyId: string, overrides: Record<string, unknown> = {}) {
  const res = await call(app, "POST", `/api/studies/${studyId}/rounds`, { cookie: user.cookie, body: roundInput(overrides) });
  if (res.status !== 201) throw new Error(`create round failed: ${res.status} ${res.text}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return res.json as { id: string; seq: number; infoVersion: number; notesVersion: number; [k: string]: any };
}

/** An admin, a study (via the API) whose role `member` holds, and an outsider. */
export async function studySetup(app: App, opts: { studyOverrides?: Record<string, unknown> } = {}) {
  const roleId = newSnowflake();
  const admin = await login(app, { isAdmin: true });
  const member = await login(app, { roles: [roleId] });
  const outsider = await login(app);
  const study = await createStudy(app, admin, { discordRoleId: roleId, ...opts.studyOverrides });
  return { admin, member, outsider, study, roleId };
}
