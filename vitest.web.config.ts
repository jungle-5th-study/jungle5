import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    name: "web",
    environment: "jsdom",
    include: ["src/web/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/web/test/setup.ts"],
    restoreMocks: true,
  },
});
