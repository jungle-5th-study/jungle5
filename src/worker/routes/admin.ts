// Operator tools (TD-27).
import { Hono } from "hono";
import { DiscordApiError } from "../discord/appClient";
import { discordUnavailable, forbidden } from "../lib/errors";
import { canManageDiscordCommands } from "../policies";
import type { AppEnv } from "../types";

export const adminRoutes = new Hono<AppEnv>()
  // Registers (creates or overwrites) the "정글5에 올리기" message command as a
  // guild command of DISCORD_GUILD_ID, using a client-credentials token. Run
  // once after setup, and again if the command definition changes.
  .post("/discord/commands", async (c) => {
    if (!canManageDiscordCommands(c.get("actor"))) throw forbidden();
    const deps = c.get("deps");
    try {
      const command = await deps.discordApp(c.env, deps.fetch).registerUploadCommand();
      return c.json({ command });
    } catch (err) {
      if (err instanceof DiscordApiError) {
        console.error(`register discord command: ${err.message} (${err.status})`);
        throw discordUnavailable(`Discord 명령 등록에 실패했습니다 (Discord 응답 ${err.status})`);
      }
      throw err;
    }
  });
