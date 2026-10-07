import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, request, setUnauthorizedHandler } from "./api";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function mockFetch(res: Response | Error) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(() => (res instanceof Error ? Promise.reject(res) : Promise.resolve(res)));
}

async function catchError(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error("expected an ApiError");
}

describe("API client", () => {
  afterEach(() => setUnauthorizedHandler(null));

  it("sends JSON content type and same-origin credentials on mutations, including bodiless DELETE", async () => {
    const fetchSpy = mockFetch(new Response(null, { status: 204 }));
    await expect(request("/api/posts/x", { method: "DELETE" })).resolves.toBeUndefined();
    const init = fetchSpy.mock.calls[0]![1]!;
    expect(init.method).toBe("DELETE");
    expect(init.credentials).toBe("same-origin");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(init.body).toBeUndefined();
  });

  it("does not send a content type on GET", async () => {
    const fetchSpy = mockFetch(jsonResponse(200, { ok: true }));
    await expect(request("/api/me")).resolves.toEqual({ ok: true });
    expect((fetchSpy.mock.calls[0]![1]!.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });

  it("maps 422 VALIDATION with field errors", async () => {
    mockFetch(
      jsonResponse(422, {
        error: { code: "VALIDATION", message: "입력값을 확인하세요", fields: { title: ["필수 항목입니다"], "links.0.url": ["http 또는 https 주소만 허용됩니다"] } },
      }),
    );
    const err = await catchError(request("/api/posts", { method: "POST", body: {} }));
    expect(err.status).toBe(422);
    expect(err.code).toBe("VALIDATION");
    expect(err.message).toBe("입력값을 확인하세요");
    expect(err.fields).toEqual({ title: ["필수 항목입니다"], "links.0.url": ["http 또는 https 주소만 허용됩니다"] });
  });

  it("maps 409 DUPLICATE with the existing resource", async () => {
    const existing = { id: "c1", name: "React", archived: false, createdAt: 1 };
    mockFetch(jsonResponse(409, { error: { code: "DUPLICATE", message: "같은 이름의 카테고리가 이미 있습니다", existing } }));
    const err = await catchError(request("/api/categories", { method: "POST", body: { name: "react" } }));
    expect(err.code).toBe("DUPLICATE");
    expect(err.existing).toEqual(existing);
  });

  it("maps 429 RATE_LIMITED with retryAfterSeconds", async () => {
    mockFetch(jsonResponse(429, { error: { code: "RATE_LIMITED", message: "m", retryAfterSeconds: 42 } }));
    const err = await catchError(request("/api/me/refresh-roles", { method: "POST" }));
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.retryAfterSeconds).toBe(42);
  });

  it.each(["UNAUTHENTICATED", "NOT_GUILD_MEMBER"] as const)("signals the 401 handler for %s", async (code) => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    mockFetch(jsonResponse(401, { error: { code, message: "x" } }));
    const err = await catchError(request("/api/me"));
    expect(err.isAuthError).toBe(true);
    expect(handler).toHaveBeenCalledWith(code);
  });

  it("does not signal the 401 handler for other errors", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    mockFetch(jsonResponse(403, { error: { code: "FORBIDDEN", message: "권한이 없습니다" } }));
    const err = await catchError(request("/api/posts/x", { method: "PATCH", body: {} }));
    expect(err.code).toBe("FORBIDDEN");
    expect(handler).not.toHaveBeenCalled();
  });

  it("maps non-JSON error bodies and network failures", async () => {
    mockFetch(new Response("<html>bad gateway</html>", { status: 502 }));
    const e1 = await catchError(request("/api/home"));
    expect(e1.status).toBe(502);
    expect(e1.code).toBe("UNKNOWN");
    expect(e1.message).toContain("서버 오류");

    vi.restoreAllMocks();
    mockFetch(new TypeError("Failed to fetch"));
    const e2 = await catchError(request("/api/home"));
    expect(e2.code).toBe("NETWORK");
    expect(e2.status).toBe(0);
  });
});
