// 5xx alerting (TSD 9.4, TD-19).
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ALERT_INTERVAL_MS, claimAlertSlot } from "../../src/worker/lib/alert";
import { call, makeApp, stubDiscord } from "../helpers";
import type { App } from "../../src/worker/app";

/** Triggers an unexpected (non-Discord) error inside /auth/callback → 500. */
const WEBHOOK = "https://discord.test/webhook";

async function boom(app: App, envOverride: Partial<Env> = { ALERT_WEBHOOK_URL: WEBHOOK }) {
  const start = await call(app, "GET", "/auth/login");
  const state = /j5_oauth_state=([^;]+)/.exec(start.headers.get("Set-Cookie") ?? "")?.[1] ?? "";
  return call(app, "GET", `/auth/callback?code=c&state=${state}`, {
    cookie: `j5_oauth_state=${state}`,
    env: envOverride,
  });
}

const exploding = stubDiscord({ exchangeCode: () => Promise.reject(new Error("kaboom secret-detail")) });

describe("alert throttle", () => {
  it("allows one alert per 10 minutes", async () => {
    const t0 = 1_000_000_000_000;
    expect(await claimAlertSlot(env.DB, t0)).toBe(true);
    expect(await claimAlertSlot(env.DB, t0 + 1)).toBe(false);
    expect(await claimAlertSlot(env.DB, t0 + ALERT_INTERVAL_MS - 1)).toBe(false);
    expect(await claimAlertSlot(env.DB, t0 + ALERT_INTERVAL_MS)).toBe(true);
  });
});

describe("onError", () => {
  it("returns 500 INTERNAL, posts one webhook without PII, and throttles the next", async () => {
    await env.DB.prepare("DELETE FROM ops_state").run();
    const sent: { url: string; body: string }[] = [];
    const app = makeApp({
      discord: () => exploding,
      fetch: (input, init) => {
        sent.push({ url: input instanceof Request ? input.url : input.toString(), body: typeof init?.body === "string" ? init.body : "" });
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    });
    const first = await boom(app);
    expect(first.status).toBe(500);
    expect(first.json.error.code).toBe("INTERNAL");
    expect(first.text).not.toContain("kaboom");
    expect(first.headers.get("X-Content-Type-Options")).toBe("nosniff");

    expect((await boom(app)).status).toBe(500);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(WEBHOOK);
    expect(sent[0]!.body).toContain("/auth/callback");
    expect(sent[0]!.body).not.toContain("code=c");
    expect(sent[0]!.body).not.toContain("kaboom");
  });

  it("skips the webhook when ALERT_WEBHOOK_URL is unset", async () => {
    await env.DB.prepare("DELETE FROM ops_state").run();
    const sent: unknown[] = [];
    const app = makeApp({
      discord: () => exploding,
      fetch: () => {
        sent.push(1);
        return Promise.resolve(new Response(null));
      },
    });
    const res = await boom(app, { ALERT_WEBHOOK_URL: "" });
    expect(res.status).toBe(500);
    expect(sent).toHaveLength(0);
  });

  it("4xx errors do not alert", async () => {
    await env.DB.prepare("DELETE FROM ops_state").run();
    const sent: unknown[] = [];
    const app = makeApp({
      fetch: () => {
        sent.push(1);
        return Promise.resolve(new Response(null));
      },
    });
    await call(app, "GET", "/api/me");
    expect(sent).toHaveLength(0);
  });
});
