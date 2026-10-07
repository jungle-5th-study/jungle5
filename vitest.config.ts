import { defineConfig } from "vitest/config";

// Two projects: the Worker/API tests run inside workerd with a local D1; the
// SPA tests run in jsdom. `pnpm test` runs both.
export default defineConfig({
  test: {
    projects: ["./vitest.workers.config.ts", "./vitest.web.config.ts"],
  },
});
