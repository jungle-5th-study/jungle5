// Worker entry point. The test-login route exists only when ENV === "test".
import { createApp, type App } from "./app";

const apps = new Map<boolean, App>();

function appFor(env: Env): App {
  const testLogin = env.ENV === "test";
  let app = apps.get(testLogin);
  if (!app) {
    app = createApp({ testLogin });
    apps.set(testLogin, app);
  }
  return app;
}

/**
 * Requests that reach the Worker on another host (the old *.workers.dev address)
 * are sent permanently to APP_ORIGIN, keeping path and query.
 */
export function canonicalRedirect(request: Request, appOrigin: string): Response | null {
  const url = new URL(request.url);
  const canonical = new URL(appOrigin);
  if (!url.hostname.endsWith(".workers.dev") || url.host === canonical.host) return null;
  return Response.redirect(`${canonical.origin}${url.pathname}${url.search}`, 301);
}

export default {
  fetch(request, env, ctx) {
    return canonicalRedirect(request, env.APP_ORIGIN) ?? appFor(env).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
