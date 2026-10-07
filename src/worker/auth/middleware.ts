// Per-request checks (TSD 6.2) and Discord re-verification (6.3).
import { eq } from "drizzle-orm";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { authSessions, discordTokens, members } from "../db/schema";
import { decryptSecret, sha256Hex } from "../lib/crypto";
import { forbidden, notGuildMember, unauthenticated } from "../lib/errors";
import type { Actor } from "../policies";
import type { AppEnv, Db } from "../types";
import { resolveProfile, type DiscordClient, type DiscordTokens } from "./discord";
import { studyMembershipStatements } from "./studyRoles";
import {
  clearSessionCookie,
  encryptTokens,
  OUTAGE_GRACE_MS,
  REVERIFY_AFTER_MS,
  revokeAllSessions,
  SESSION_COOKIE,
} from "./session";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** The one route whose body is a raw file, not JSON: PUT /api/posts/:id/html (TD-25, TSD 3.2). */
const RAW_HTML_UPLOAD = /^\/api\/posts\/[^/]+\/html$/;

/**
 * 6.2 step 4: mutating requests need Origin === APP_ORIGIN and a JSON body
 * type; the HTML upload needs `text/html` or `application/gzip` instead. None
 * is a CORS-safelisted type, so a cross-site page can only send them after a
 * preflight, which this API never answers with CORS headers.
 */
export const csrfGuard = createMiddleware<AppEnv>(async (c, next) => {
  if (MUTATING.has(c.req.method)) {
    const origin = c.req.header("Origin");
    const contentType = c.req.header("Content-Type") ?? "";
    if (origin !== c.env.APP_ORIGIN) throw forbidden("허용되지 않은 출처의 요청입니다");
    if (c.req.method === "PUT" && RAW_HTML_UPLOAD.test(c.req.path)) {
      if (!/^(text\/html|application\/gzip)(\s*;|$)/i.test(contentType)) {
        throw forbidden("Content-Type: text/html 또는 application/gzip 이 필요합니다");
      }
    } else if (!/^application\/json(\s*;|$)/i.test(contentType)) {
      throw forbidden("Content-Type: application/json 이 필요합니다");
    }
  }
  await next();
});

/** 6.2 steps 1-3. Sets `actor`. */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const db = c.get("db");
  const now = c.get("deps").now();
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) throw unauthenticated();
  const tokenHash = await sha256Hex(token);

  const row = await db
    .select({
      expiresAt: authSessions.expiresAt,
      member: {
        id: members.id,
        discordUserId: members.discordUserId,
        displayName: members.displayName,
        isAdmin: members.isAdmin,
        isGuildMember: members.isGuildMember,
        verifiedAt: members.verifiedAt,
        withdrawnAt: members.withdrawnAt,
      },
    })
    .from(authSessions)
    .innerJoin(members, eq(members.id, authSessions.memberId))
    .where(eq(authSessions.tokenHash, tokenHash))
    .get();

  if (!row || row.expiresAt <= now) {
    clearSessionCookie(c);
    throw unauthenticated();
  }
  const m = row.member;
  if (m.withdrawnAt !== null) throw unauthenticated();
  if (!m.isGuildMember) throw notGuildMember();

  let actor: Actor = { id: m.id, isAdmin: m.isAdmin, isGuildMember: true, withdrawn: false };
  const reverifyInput: ReverifyInput = {
    memberId: m.id,
    verifiedAt: m.verifiedAt,
    fallbackName: m.displayName,
    discordUserId: m.discordUserId ?? "",
    tokenHash,
    now,
  };
  c.set("reverifyInput", reverifyInput);
  c.set("reverified", false);
  if (now - m.verifiedAt > REVERIFY_AFTER_MS) {
    const outcome = await reverify(db, c.env, c.get("deps").discord(c.env), reverifyInput);
    if (outcome.kind === "rejected") {
      clearSessionCookie(c);
      throw outcome.error;
    }
    if (outcome.kind === "refreshed") {
      actor = { ...actor, isAdmin: outcome.isAdmin };
      c.set("reverified", true);
    }
  }
  c.set("actor", actor);
  await next();
});

export interface ReverifyInput {
  memberId: string;
  verifiedAt: number;
  fallbackName: string | null;
  discordUserId: string;
  tokenHash: string;
  now: number;
}

export type ReverifyOutcome =
  | { kind: "refreshed"; isAdmin: boolean }
  /** Discord unavailable but within the 72h grace window: allow unchanged. */
  | { kind: "grace" }
  /** Discord unavailable and the caller asked not to apply the grace window. */
  | { kind: "unavailable" }
  | { kind: "rejected"; error: Error };

/**
 * TSD 6.3. On success also recomputes study memberships from the member's
 * Discord roles (TD-23). Queries: tokens read (1) + at most one write batch.
 *
 * `onUnavailable`: "grace" (the 24h background check) applies the 72h outage
 * grace window; "fail" (an explicit refresh by the member) reports
 * `unavailable` instead and leaves the session alone.
 */
export async function reverify(
  db: Db,
  env: Env,
  discord: DiscordClient,
  m: ReverifyInput,
  onUnavailable: "grace" | "fail" = "grace",
): Promise<ReverifyOutcome> {
  const { now } = m;
  const revokeAndReject = async (error: Error): Promise<ReverifyOutcome> => {
    await revokeAllSessions(db, m.memberId);
    return { kind: "rejected", error };
  };
  const grace = async (): Promise<ReverifyOutcome> => {
    if (onUnavailable === "fail") return { kind: "unavailable" };
    if (now - m.verifiedAt < OUTAGE_GRACE_MS) return { kind: "grace" };
    await db.delete(authSessions).where(eq(authSessions.tokenHash, m.tokenHash));
    return { kind: "rejected", error: unauthenticated("Discord 확인이 오래 실패했습니다. 다시 로그인하세요") };
  };

  const stored = await db.select().from(discordTokens).where(eq(discordTokens.memberId, m.memberId)).get();
  if (!stored) return revokeAndReject(unauthenticated("다시 로그인하세요"));

  let accessToken: string;
  let refreshToken: string;
  try {
    accessToken = await decryptSecret(stored.accessTokenEnc, env.TOKEN_ENC_KEY);
    refreshToken = await decryptSecret(stored.refreshTokenEnc, env.TOKEN_ENC_KEY);
  } catch {
    return revokeAndReject(unauthenticated("다시 로그인하세요"));
  }

  let newTokens: DiscordTokens | null = null;
  const tryRefresh = async (): Promise<"ok" | "invalid" | "unavailable"> => {
    const r = await discord.refresh(refreshToken);
    if (r.kind !== "ok") return r.kind;
    newTokens = r.tokens;
    accessToken = r.tokens.accessToken;
    return "ok";
  };

  if (stored.accessExpiresAt <= now) {
    const r = await tryRefresh();
    if (r === "invalid") return revokeAndReject(unauthenticated("다시 로그인하세요"));
    if (r === "unavailable") return grace();
  }

  let result = await discord.getGuildMember(accessToken, env.DISCORD_GUILD_ID);
  if (result.kind === "unauthorized" && newTokens === null) {
    const r = await tryRefresh();
    if (r === "invalid") return revokeAndReject(unauthenticated("다시 로그인하세요"));
    if (r === "unavailable") return grace();
    result = await discord.getGuildMember(accessToken, env.DISCORD_GUILD_ID);
  }

  switch (result.kind) {
    case "unauthorized":
      return revokeAndReject(unauthenticated("다시 로그인하세요"));
    case "unavailable":
      return grace();
    case "not_member":
      await db.batch([
        db.update(members).set({ isGuildMember: false }).where(eq(members.id, m.memberId)),
        revokeAllSessions(db, m.memberId),
      ]);
      return { kind: "rejected", error: notGuildMember() };
    case "ok": {
      const user = result.member.user ?? {
        id: m.discordUserId,
        username: m.fallbackName ?? "member",
      };
      const profile = resolveProfile(user, result.member, env.DISCORD_GUILD_ID, env.DISCORD_ADMIN_ROLE_ID);
      const memberUpdate = db
        .update(members)
        .set({
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
          isAdmin: profile.isAdmin,
          isGuildMember: true,
          verifiedAt: now,
          discordRoleIds: JSON.stringify(profile.roleIds),
        })
        .where(eq(members.id, m.memberId));
      const membership = studyMembershipStatements(db, m.memberId, profile.roleIds, now);
      const refreshed = newTokens as DiscordTokens | null;
      if (refreshed) {
        const enc = await encryptTokens(refreshed, env.TOKEN_ENC_KEY);
        await db.batch([
          memberUpdate,
          ...membership,
          db.update(discordTokens).set(enc).where(eq(discordTokens.memberId, m.memberId)),
        ]);
      } else {
        await db.batch([memberUpdate, ...membership]);
      }
      return { kind: "refreshed", isAdmin: profile.isAdmin };
    }
  }
}
