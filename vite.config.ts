import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

/**
 * Dev only. The Worker sends the production CSP (TSD 9.5) on every response,
 * but Vite's dev server needs inline <style> (CSS HMR) and an inline React
 * Refresh preamble. Vite marks those with `html.cspNonce`; this middleware adds
 * the same nonce to the CSP header so dev keeps an otherwise identical policy.
 * Never part of `vite build` output.
 */
const DEV_NONCE = "jungle5-dev";
function devCspNonce(): Plugin {
  return {
    name: "jungle5:dev-csp-nonce",
    apply: "serve",
    config: () => ({ html: { cspNonce: DEV_NONCE } }),
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        const setHeader = res.setHeader.bind(res);
        res.setHeader = (name, value) => {
          if (name.toLowerCase() === "content-security-policy" && typeof value === "string") {
            value = value
              .replace("script-src 'self'", `script-src 'self' 'nonce-${DEV_NONCE}'`)
              .replace("style-src 'self'", `style-src 'self' 'nonce-${DEV_NONCE}'`);
          }
          return setHeader(name, value);
        };
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [devCspNonce(), react(), tailwindcss(), cloudflare()],
  server: {
    // Matches APP_ORIGIN in .dev.vars (CSRF Origin check, OAuth redirect URL).
    port: 8787,
    strictPort: true,
  },
  preview: { port: 8787, strictPort: true },
});
