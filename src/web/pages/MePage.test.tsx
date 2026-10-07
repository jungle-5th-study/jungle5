import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me } from "../../shared/api";
import { queryKeys } from "../lib/endpoints";
import { SessionContext } from "../lib/session";
import { MePage } from "./MePage";

const me: Me = { id: "0190a000-0000-7000-8000-0000000000aa", displayName: "tester", avatarUrl: null, isAdmin: false, studies: [] };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  queryClient.setQueryData(queryKeys.me, me);
  const router = createMemoryRouter([{ path: "/me", element: <MePage /> }], { initialEntries: ["/me"] });
  render(
    <QueryClientProvider client={queryClient}>
      <SessionContext.Provider value={me}>
        <RouterProvider router={router} />
      </SessionContext.Provider>
    </QueryClientProvider>,
  );
  return { queryClient, user: userEvent.setup() };
}

describe("MePage: Discord 역할 새로고침 (UD-15)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows the wait time on 429 RATE_LIMITED", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json(429, { error: { code: "RATE_LIMITED", message: "역할은 60초에 한 번 새로고침할 수 있습니다", retryAfterSeconds: 42 } }),
    );
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Discord 역할 새로고침" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("42초 후에 다시 시도하세요");
    expect(screen.getByRole("button", { name: "Discord 역할 새로고침" })).toBeEnabled();
  });

  it("explains 503 DISCORD_UNAVAILABLE", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json(503, { error: { code: "DISCORD_UNAVAILABLE", message: "Discord 오류" } }),
    );
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Discord 역할 새로고침" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Discord에 연결하지 못했습니다");
  });

  it("updates the me query on success", async () => {
    const updated: Me = { ...me, studies: [{ id: "s1", name: "DDIA", status: "active" }] };
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(json(200, updated)));
    const { queryClient, user } = setup();
    await user.click(screen.getByRole("button", { name: "Discord 역할 새로고침" }));
    await waitFor(() => expect(queryClient.getQueryData<Me>(queryKeys.me)?.studies).toHaveLength(1));
    expect(spy.mock.calls[0]![0]).toBe("/api/me/refresh-roles");
    expect(spy.mock.calls[0]![1]!.method).toBe("POST");
  });

  it("offers the theme setting", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("radio", { name: /다크/ }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    await user.click(screen.getByRole("radio", { name: /시스템 설정/ }));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});
