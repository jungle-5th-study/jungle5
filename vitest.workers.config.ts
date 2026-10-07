import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

// wrangler.jsonc points at the SPA build output; make sure it exists so the
// assets binding can be created even when `pnpm build` has not run.
const assetsDir = join(root, "dist", "client");
if (!existsSync(join(assetsDir, "index.html"))) {
  mkdirSync(assetsDir, { recursive: true });
  writeFileSync(
    join(assetsDir, "index.html"),
    '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>정글5</title></head><body></body></html>\n',
  );
}

export const TEST_APP_ORIGIN = "https://jungle5.test";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(join(root, "migrations"));
      return {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            ENV: "test",
            APP_ORIGIN: TEST_APP_ORIGIN,
            DISCORD_CLIENT_ID: "test-client",
            DISCORD_CLIENT_SECRET: "test-secret",
            DISCORD_GUILD_ID: "100000000000000000",
            DISCORD_ADMIN_ROLE_ID: "200000000000000000",
            // 32 zero bytes — test only.
            TOKEN_ENC_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            // Tests that exercise alerts set it explicitly with a stubbed fetch.
            ALERT_WEBHOOK_URL: "",
            TEST_MIGRATIONS: migrations,
          },
          // An empty database for the migration test (tests/migrations.test.ts),
          // which applies the migrations one by one itself.
          d1Databases: { MIGRATION_DB: "migration-test-db" },
        },
      };
    }),
  ],
  test: {
    name: "worker",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/apply-migrations.ts"],
  },
});
