// Sessions (TSD 6.1 step 4-5): member upsert, encrypted Discord tokens, session cookie.
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { uuidv7 } from "../../shared/ids";
import { authSessions, discordTokens, members } from "../db/schema";
import { encryptSecret, randomToken, sha256Hex } from "../lib/crypto";
import type { AppEnv, Db } from "../types";
import type { DiscordTokens, Profile } from "./discord";
import { studyMembershipStatements } from "./studyRoles";

export const SESSION_COOKIE = "j5_session";
export const STATE_COOKIE = "j5_oauth_state";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const REVERIFY_AFTER_MS = 24 * 60 * 60 * 1000;
export const OUTAGE_GRACE_MS = 72 * 60 * 60 * 1000;

export async function encryptTokens(tokens: DiscordTokens, key: string) {
  return {
    accessTokenEnc: await encryptSecret(tokens.accessToken, key),
    refreshTokenEnc: await encryptSecret(tokens.refreshToken, key),
    accessExpiresAt: tokens.expiresAt,
  };
}

/**
 * Finds or creates the member for a Discord account, refreshes its profile and
 * tokens, and issues a new session. Withdrawn members have a NULL
 * discord_user_id, so a returning account gets a fresh row (TSD 5.2).
 * Study memberships are recomputed from the profile's role IDs (TD-23).
 * Queries: 1 read + 1 batch.
 */
export async function loginMember(
  db: Db,
  env: Env,
  input: { discordUserId: string; profile: Profile; tokens: DiscordTokens; now: number },
): Promise<{ memberId: string; sessionToken: string }> {
  const { discordUserId, profile, tokens, now } = input;
  const existing = await db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.discordUserId, discordUserId))
    .get();
  const memberId = existing?.id ?? uuidv7(now);
  const enc = await encryptTokens(tokens, env.TOKEN_ENC_KEY);
  const sessionToken = randomToken(32);
  const tokenHash = await sha256Hex(sessionToken);

  const memberWrite = existing
    ? db
        .update(members)
        .set({
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
          isAdmin: profile.isAdmin,
          isGuildMember: true,
          verifiedAt: now,
          discordRoleIds: JSON.stringify(profile.roleIds),
        })
        .where(eq(members.id, memberId))
    : db.insert(members).values({
        id: memberId,
        discordUserId,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        isAdmin: profile.isAdmin,
        isGuildMember: true,
        verifiedAt: now,
        discordRoleIds: JSON.stringify(profile.roleIds),
        createdAt: now,
      });

  await db.batch([
    memberWrite,
    db
      .insert(discordTokens)
      .values({ memberId, ...enc })
      .onConflictDoUpdate({ target: discordTokens.memberId, set: enc }),
    db.insert(authSessions).values({ tokenHash, memberId, expiresAt: now + SESSION_TTL_MS, createdAt: now }),
    ...studyMembershipStatements(db, memberId, profile.roleIds, now),
  ]);
  return { memberId, sessionToken };
}

export function setSessionCookie(c: Context<AppEnv>, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(c: Context<AppEnv>) {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true, httpOnly: true, sameSite: "Lax" });
}

export const revokeAllSessions = (db: Db, memberId: string) =>
  db.delete(authSessions).where(eq(authSessions.memberId, memberId));
