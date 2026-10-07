// Worker bindings and configuration (TSD 4.2).
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ASSETS: Fetcher;
    /** "production" | "test" (test enables /auth/test-login). */
    ENV: string;
    APP_ORIGIN: string;
    DISCORD_CLIENT_ID: string;
    DISCORD_CLIENT_SECRET: string;
    DISCORD_GUILD_ID: string;
    DISCORD_ADMIN_ROLE_ID: string;
    /** base64 AES-256 key */
    TOKEN_ENC_KEY: string;
    /** Optional: alerts are skipped when unset. */
    ALERT_WEBHOOK_URL?: string;
  }
}

type Env = Cloudflare.Env;
