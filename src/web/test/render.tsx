// Test helper: render routes with a session, a query client and a memory router.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { vi } from "vitest";
import type { Me } from "../../shared/api";
import { queryKeys } from "../lib/endpoints";
import { SessionContext } from "../lib/session";

export const testMe: Me = {
  id: "0190a000-0000-7000-8000-0000000000aa",
  displayName: "tester",
  avatarUrl: null,
  isAdmin: false,
  studies: [],
};

export const json = (status: number, body: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export function renderRoutes(
  routes: RouteObject[],
  path: string,
  { me = testMe, data = [] as [readonly unknown[], unknown][] } = {},
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  queryClient.setQueryData(queryKeys.me, me);
  for (const [key, value] of data) queryClient.setQueryData(key, value);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={queryClient}>
      <SessionContext.Provider value={me}>
        <RouterProvider router={router} />
      </SessionContext.Provider>
    </QueryClientProvider>,
  );
  return { router, queryClient, user: userEvent.setup() };
}

type Handler = (url: string, init: RequestInit | undefined) => Response | Promise<Response> | undefined;

/** fetch stub: the first handler returning a Response wins; anything else fails the request. */
export function stubFetch(handler: Handler) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const res = await handler(url, init);
    if (res) return res;
    throw new Error(`unexpected fetch ${init?.method ?? "GET"} ${url}`);
  });
}
