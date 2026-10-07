import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
      /** Empty D1 for tests/migrations.test.ts. */
      MIGRATION_DB: D1Database;
    }
  }
}
