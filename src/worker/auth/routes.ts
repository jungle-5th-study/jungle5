// /auth/* (TSD 6.1). /auth/test-login exists only when ENV === "test" (TSD 9.1).
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { authSessions } from "../db/schema";
import { randomToken, sha256Hex } from "../lib/crypto";
import { parseOrThrow, readJson } from "../lib/errors";
import type { AppEnv } from "../types";
import { csrfGuard } from "./middleware";
import { DiscordError, resolveProfile } from "./discord";
import { clearSessionCookie, loginMember, SESSION_COOKIE, setSessionCookie, STATE_COOKIE } from "./session";

const redirectUri = (env: Env) => `${env.APP_ORIGIN}/auth/callback`;

export function authRoutes(opts: { testLogin: boolean }) {
  const auth = new Hono<AppEnv>();

  auth.get("/login", (c) => {
    const state = randomToken(16);
    setCookie(c, STATE_COOKIE, state, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/auth",
      maxAge: 600,
    });
    return c.redirect(c.get("deps").discord(c.env).authorizeUrl(state, redirectUri(c.env)), 302);
  });

  auth.get("/callback", async (c) => {
    const fail = (reason: string) => c.redirect(`/login?error=${reason}`, 302);
    const expected = getCookie(c, STATE_COOKIE);
    deleteCookie(c, STATE_COOKIE, { path: "/auth", secure: true, httpOnly: true, sameSite: "Lax" });
    const { state, code, error } = c.req.query();
    if (error) return fail("access_denied");
    if (!expected || !state || state !== expected) return fail("invalid_state");
    if (!code) return fail("invalid_request");

    const discord = c.get("deps").discord(c.env);
    const now = c.get("deps").now();
    try {
      const tokens = await discord.exchangeCode(code, redirectUri(c.env));
      const user = await discord.getUser(tokens.accessToken);
      const result = await discord.getGuildMember(tokens.accessToken, c.env.DISCORD_GUILD_ID);
      if (result.kind === "not_member") return fail("not_member");
      if (result.kind !== "ok") {
        console.error(`discord callback: guild member lookup ${result.kind}`);
        return fail("discord_error");
      }
      const profile = resolveProfile(user, result.member, c.env.DISCORD_GUILD_ID, c.env.DISCORD_ADMIN_ROLE_ID);
      const { sessionToken } = await loginMember(c.get("db"), c.env, {
        discordUserId: user.id,
        profile,
        tokens,
        now,
      });
      setSessionCookie(c, sessionToken);
      return c.redirect("/", 302);
    } catch (err) {
      if (err instanceof DiscordError) {
        // Status only (e.g. "token exchange failed: 401"); never tokens or secrets.
        console.error(`discord callback: ${err.message}`);
        return fail("discord_error");
      }
      throw err;
    }
  });

  auth.post("/logout", csrfGuard, async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      await c.get("db").delete(authSessions).where(eq(authSessions.tokenHash, await sha256Hex(token)));
    }
    clearSessionCookie(c);
    return c.body(null, 204);
  });

  if (opts.testLogin) {
    const testLoginSchema = z.object({
      discordUserId: z.string().min(1).max(32),
      displayName: z.string().min(1).max(100).optional(),
      isAdmin: z.boolean().optional().default(false),
      /** Guild role IDs, as Discord would report them (study membership, D-23). */
      roles: z.array(z.string().min(1).max(32)).max(250).optional().default([]),
    });
    // Local/E2E only. Creates or updates a member as if Discord had confirmed it.
    auth.post("/test-login", csrfGuard, async (c) => {
      const input = parseOrThrow(testLoginSchema, await readJson(c));
      const now = c.get("deps").now();
      const { memberId, sessionToken } = await loginMember(c.get("db"), c.env, {
        discordUserId: input.discordUserId,
        profile: {
          displayName: input.displayName ?? `tester-${input.discordUserId}`,
          avatarUrl: `https://cdn.discordapp.com/avatars/${input.discordUserId}/test.png`,
          isAdmin: input.isAdmin,
          roleIds: input.roles,
        },
        tokens: {
          accessToken: `test-access-${input.discordUserId}`,
          refreshToken: `test-refresh-${input.discordUserId}`,
          expiresAt: now + 7 * 24 * 60 * 60 * 1000,
        },
        now,
      });
      setSessionCookie(c, sessionToken);
      return c.json({ memberId });
    });
  }

  return auth;
}
