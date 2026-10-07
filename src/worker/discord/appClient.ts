// Discord HTTP calls of the "정글5에 올리기" message command (TD-27), behind an
// interface built on an injectable fetch so tests never hit the network.
// Interaction follow-ups use the interaction token (no bot token needed).
import { readBodyCapped } from "../lib/postHtml";

const API = "https://discord.com/api/v10";

/** Message command name shown in Discord's "Apps" menu (D-32). */
export const UPLOAD_COMMAND_NAME = "정글5에 올리기";

/** Hosts an attachment URL may point to; anything else is refused before fetching. */
export const ATTACHMENT_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

export class DiscordApiError extends Error {
  override name = "DiscordApiError";
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface RegisteredCommand {
  id: string;
  name: string;
  type: number;
  guildId: string;
}

export interface DiscordAppClient {
  /** Downloads an attachment (allowed hosts only). Throws DiscordApiError on failure or when larger than maxBytes. */
  downloadAttachment(url: string, maxBytes: number): Promise<Uint8Array>;
  /** PATCH the original (deferred) interaction response. */
  editOriginal(interactionToken: string, content: string): Promise<void>;
  /** A new follow-up message; public unless `ephemeral`. Mentions are never parsed. */
  followUp(interactionToken: string, content: string, ephemeral?: boolean): Promise<void>;
  /** Client-credentials token, then create/overwrite the guild message command. */
  registerUploadCommand(): Promise<RegisteredCommand>;
}

const NO_MENTIONS = { parse: [] as string[] };

export function isAllowedAttachmentUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && ATTACHMENT_HOSTS.has(url.hostname) && url.port === "";
  } catch {
    return false;
  }
}

export function createDiscordAppClient(env: Env, fetchImpl: typeof fetch): DiscordAppClient {
  const webhook = (token: string) => `${API}/webhooks/${env.DISCORD_CLIENT_ID}/${encodeURIComponent(token)}`;

  async function send(url: string, method: string, body: unknown, headers: Record<string, string> = {}) {
    const res = await fetchImpl(url, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new DiscordApiError(`${method} ${new URL(url).pathname.split("/").slice(0, 5).join("/")} failed`, res.status);
    return res;
  }

  return {
    async downloadAttachment(url, maxBytes) {
      if (!isAllowedAttachmentUrl(url)) throw new DiscordApiError("attachment host not allowed", 0);
      // No redirects: a 3xx is not ok and is refused (the host check must hold for the final URL).
      const res = await fetchImpl(url, { redirect: "manual" });
      if (!res.ok) throw new DiscordApiError("attachment download failed", res.status);
      const declared = Number(res.headers.get("Content-Length") ?? "0");
      if (declared > maxBytes) {
        await res.body?.cancel().catch(() => undefined);
        throw new DiscordApiError("attachment too large", 413);
      }
      // Stops reading once past maxBytes, whatever Content-Length said.
      const bytes = await readBodyCapped(res.body, maxBytes);
      if (!bytes) throw new DiscordApiError("attachment too large", 413);
      return bytes;
    },

    async editOriginal(token, content) {
      await send(`${webhook(token)}/messages/@original`, "PATCH", { content, allowed_mentions: NO_MENTIONS });
    },

    async followUp(token, content, ephemeral = false) {
      await send(webhook(token), "POST", {
        content,
        allowed_mentions: NO_MENTIONS,
        ...(ephemeral && { flags: 64 }),
      });
    },

    async registerUploadCommand() {
      const tokenRes = await fetchImpl(`${API}/oauth2/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${btoa(`${env.DISCORD_CLIENT_ID}:${env.DISCORD_CLIENT_SECRET}`)}`,
        },
        body: new URLSearchParams({ grant_type: "client_credentials", scope: "applications.commands.update" }),
      });
      if (!tokenRes.ok) throw new DiscordApiError("client credentials token failed", tokenRes.status);
      const { access_token } = await tokenRes.json<{ access_token: string }>();
      // POST creates or overwrites the command with the same name; other commands are untouched.
      const res = await send(
        `${API}/applications/${env.DISCORD_CLIENT_ID}/guilds/${env.DISCORD_GUILD_ID}/commands`,
        "POST",
        { name: UPLOAD_COMMAND_NAME, type: 3, contexts: [0], integration_types: [0] },
        { Authorization: `Bearer ${access_token}` },
      );
      const cmd = await res.json<{ id: string; name: string; type: number; guild_id?: string }>();
      return { id: cmd.id, name: cmd.name, type: cmd.type, guildId: cmd.guild_id ?? env.DISCORD_GUILD_ID };
    },
  };
}
