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
    /** Origin of the isolated HTML worker `jungle5-html` (TD-26), e.g. https://jungle5-html.jungle5.workers.dev. Also in the CSP frame-src. */
    HTML_ORIGIN: string;
    /** Secret shared with the HTML worker: HMAC-SHA256 key for signed HTML URLs (TD-26). */
    HTML_SIGNING_KEY: string;
    /** Discord application public key (hex) for interaction signatures (TD-27). Public; empty = endpoint disabled. */
    DISCORD_PUBLIC_KEY: string;
    /** Optional: alerts are skipped when unset. */
    ALERT_WEBHOOK_URL?: string;
  }
}

type Env = Cloudflare.Env;
