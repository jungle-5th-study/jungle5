import { describe, expect, it } from "vitest";
import { canonicalRedirect } from "../../src/worker/index";

const ORIGIN = "https://jungle5.xyz";

describe("canonicalRedirect", () => {
  it("sends the old workers.dev address to APP_ORIGIN with path and query", () => {
    const res = canonicalRedirect(new Request("https://jungle5.jungle5.workers.dev/posts?q=react"), ORIGIN);
    expect(res?.status).toBe(301);
    expect(res?.headers.get("Location")).toBe("https://jungle5.xyz/posts?q=react");
  });

  it("leaves requests on the canonical host alone", () => {
    expect(canonicalRedirect(new Request("https://jungle5.xyz/api/me"), ORIGIN)).toBeNull();
  });

  it("does nothing while APP_ORIGIN itself is a workers.dev address", () => {
    const origin = "https://jungle5.jungle5.workers.dev";
    expect(canonicalRedirect(new Request(`${origin}/`), origin)).toBeNull();
  });

  it("ignores localhost", () => {
    expect(canonicalRedirect(new Request("http://localhost:8787/"), "http://localhost:8787")).toBeNull();
  });
});
