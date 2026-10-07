// Discord HTTP access behind an interface so tests can stub it (no network).
const API = "https://discord.com/api/v10";
export const DISCORD_SCOPES = "identify guilds.members.read";

export interface DiscordTokens {
  accessToken: string;
  refreshToken: string;
  /** epoch ms */
  expiresAt: number;
}

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
}

export interface DiscordGuildMember {
  user?: DiscordUser;
  nick?: string | null;
  avatar?: string | null;
  roles: string[];
}

export type GuildMemberResult =
  | { kind: "ok"; member: DiscordGuildMember }
  /** 404: not in the guild */
  | { kind: "not_member" }
  /** 401/403: the token is invalid or lacks the scope */
  | { kind: "unauthorized" }
  /** 5xx, 429 or network error */
  | { kind: "unavailable" };

export type RefreshResult =
  | { kind: "ok"; tokens: DiscordTokens }
  | { kind: "invalid" }
  | { kind: "unavailable" };

export interface DiscordClient {
  authorizeUrl(state: string, redirectUri: string): string;
  /** Throws on failure (login is interactive; the user retries). */
  exchangeCode(code: string, redirectUri: string): Promise<DiscordTokens>;
  refresh(refreshToken: string): Promise<RefreshResult>;
  /** Throws on failure. */
  getUser(accessToken: string): Promise<DiscordUser>;
  getGuildMember(accessToken: string, guildId: string): Promise<GuildMemberResult>;
}

export class DiscordError extends Error {
  override name = "DiscordError";
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export function createDiscordClient(env: Env, fetchImpl: typeof fetch = fetch): DiscordClient {
  const basicAuth = `Basic ${btoa(`${env.DISCORD_CLIENT_ID}:${env.DISCORD_CLIENT_SECRET}`)}`;

  async function tokenRequest(params: Record<string, string>): Promise<Response> {
    return fetchImpl(`${API}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basicAuth },
      body: new URLSearchParams(params),
    });
  }

  const toTokens = (t: TokenResponse): DiscordTokens => ({
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: Date.now() + t.expires_in * 1000,
  });

  return {
    authorizeUrl(state, redirectUri) {
      const q = new URLSearchParams({
        response_type: "code",
        client_id: env.DISCORD_CLIENT_ID,
        scope: DISCORD_SCOPES,
        state,
        redirect_uri: redirectUri,
        prompt: "none",
      });
      return `https://discord.com/oauth2/authorize?${q.toString()}`;
    },

    async exchangeCode(code, redirectUri) {
      const res = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
      if (!res.ok) throw new DiscordError(`token exchange failed: ${res.status}`);
      return toTokens(await res.json<TokenResponse>());
    },

    async refresh(refreshToken) {
      let res: Response;
      try {
        res = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
      } catch {
        return { kind: "unavailable" };
      }
      if (res.ok) return { kind: "ok", tokens: toTokens(await res.json<TokenResponse>()) };
      if (res.status >= 500 || res.status === 429) return { kind: "unavailable" };
      return { kind: "invalid" };
    },

    async getUser(accessToken) {
      const res = await fetchImpl(`${API}/users/@me`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) throw new DiscordError(`get user failed: ${res.status}`);
      return res.json<DiscordUser>();
    },

    async getGuildMember(accessToken, guildId) {
      let res: Response;
      try {
        res = await fetchImpl(`${API}/users/@me/guilds/${guildId}/member`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      } catch {
        return { kind: "unavailable" };
      }
      if (res.ok) return { kind: "ok", member: await res.json<DiscordGuildMember>() };
      if (res.status === 404) return { kind: "not_member" };
      if (res.status === 401 || res.status === 403) return { kind: "unauthorized" };
      return { kind: "unavailable" };
    },
  };
}

export interface Profile {
  displayName: string;
  avatarUrl: string;
  isAdmin: boolean;
  /** Guild role IDs; study membership is derived from them (D-23). */
  roleIds: string[];
}

/**
 * TD-20: guild nick → global display name → username.
 * Avatar: guild avatar → user avatar → Discord default avatar.
 */
export function resolveProfile(
  user: DiscordUser,
  member: DiscordGuildMember,
  guildId: string,
  adminRoleId: string,
): Profile {
  const displayName = member.nick || user.global_name || user.username;
  let avatarUrl: string;
  if (member.avatar) {
    avatarUrl = `https://cdn.discordapp.com/guilds/${guildId}/users/${user.id}/avatars/${member.avatar}.png`;
  } else if (user.avatar) {
    avatarUrl = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`;
  } else {
    let index: number;
    try {
      index = Number((BigInt(user.id) >> 22n) % 6n);
    } catch {
      index = 0;
    }
    avatarUrl = `https://cdn.discordapp.com/embed/avatars/${index}.png`;
  }
  return { displayName, avatarUrl, isAdmin: member.roles.includes(adminRoleId), roleIds: [...member.roles] };
}
