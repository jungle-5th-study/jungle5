import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { createDiscordClient } from "./auth/discord";
import { csrfGuard, requireSession } from "./auth/middleware";
import { authRoutes } from "./auth/routes";
import * as schema from "./db/schema";
import { maybeSendAlert } from "./lib/alert";
import { AppError, errorBody, notFound } from "./lib/errors";
import { categoryRoutes } from "./routes/categories";
import { commentRoutes } from "./routes/comments";
import { meRoutes } from "./routes/me";
import { postRoutes } from "./routes/posts";
import { roundRoutes } from "./routes/rounds";
import { studyRoutes } from "./routes/studies";
import type { AppDeps, AppEnv } from "./types";

/** TSD 9.5 — applied to every response, static assets included. */
export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

export interface CreateAppOptions {
  /** Registers POST /auth/test-login. Only true when ENV === "test" (TSD 9.1). */
  testLogin: boolean;
  deps?: Partial<AppDeps>;
}

export function createApp(options: CreateAppOptions) {
  const deps: AppDeps = {
    discord: (env) => createDiscordClient(env),
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    ...options.deps,
  };
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    c.set("deps", deps);
    c.set("db", drizzle(c.env.DB, { schema }));
    c.set("requestId", c.req.header("cf-ray") ?? crypto.randomUUID());
    await next();
    // Asset responses may have immutable headers; copy before mutating.
    const res = new Response(c.res.body, c.res);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
    if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/auth/")) {
      res.headers.set("Cache-Control", "no-store");
    }
    c.res = res;
  });

  app.route("/auth", authRoutes({ testLogin: options.testLogin }));

  const api = new Hono<AppEnv>();
  // 6.2: authentication first (so unauthenticated is always 401), then CSRF.
  api.use("*", requireSession, csrfGuard);
  api.route("/", meRoutes);
  api.route("/categories", categoryRoutes);
  api.route("/posts", postRoutes);
  api.route("/", commentRoutes);
  api.route("/studies", studyRoutes);
  api.route("/rounds", roundRoutes);
  app.route("/api", api);

  app.all("/api/*", () => {
    throw notFound();
  });
  app.all("/auth/*", () => {
    throw notFound();
  });
  // Everything else is the SPA (static assets with SPA fallback).
  app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

  app.onError((err, c) => {
    if (err instanceof AppError) {
      if (err.extra.retryAfterSeconds !== undefined) c.header("Retry-After", String(err.extra.retryAfterSeconds));
      return c.json(errorBody(err), err.status);
    }
    if (err instanceof HTTPException && err.status < 500) {
      return c.json({ error: { code: "VALIDATION", message: err.message } }, err.status);
    }
    const requestId = c.get("requestId");
    console.error(JSON.stringify({ level: "error", requestId, path: c.req.path, error: String(err) }));
    const alert = maybeSendAlert(
      c.env,
      { method: c.req.method, path: c.req.path, code: "INTERNAL", requestId },
      deps.fetch,
      deps.now(),
    ).catch((e: unknown) => console.error("alert failed", String(e)));
    try {
      c.executionCtx.waitUntil(alert);
    } catch {
      // No execution context (e.g. direct app.request in tests): fire and forget.
    }
    return c.json({ error: { code: "INTERNAL", message: `서버 오류가 발생했습니다 (${requestId})` } }, 500);
  });

  app.notFound((c) => c.json(errorBody(notFound()), 404));

  return app;
}

export type App = ReturnType<typeof createApp>;
