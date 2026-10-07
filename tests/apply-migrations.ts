import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Storage is isolated per test file; apply the real migrations to each.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
