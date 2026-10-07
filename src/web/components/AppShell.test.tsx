import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Me } from "../../shared/api";
import { queryKeys } from "../lib/endpoints";
import { AppShell } from "./AppShell";

const baseMe: Me = {
  id: "0190a000-0000-7000-8000-0000000000aa",
  displayName: "테스터",
  avatarUrl: null,
  isAdmin: false,
  studies: [
    { id: "s1", name: "DDIA", status: "active" },
    { id: "s2", name: "옛 스터디", status: "ended" },
  ],
};

function setup(me: Me = baseMe, path = "/") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  queryClient.setQueryData(queryKeys.me, me);
  const router = createMemoryRouter(
    [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <p>홈 화면</p> },
          { path: "posts", element: <p>지식 화면</p> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, user: userEvent.setup() };
}

describe("AppShell", () => {
  beforeEach(() => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("lists 홈/지식/스터디 and only active studies, without categories", () => {
    setup();
    const nav = screen.getAllByRole("navigation", { name: "주요 메뉴" })[0]!;
    expect(within(nav).getByRole("link", { name: "홈" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "지식" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "스터디" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "DDIA" })).toHaveAttribute("href", "/studies/s1");
    expect(within(nav).queryByText("옛 스터디")).toBeNull();
    expect(within(nav).queryByText("카테고리")).toBeNull();
  });

  it("hides the study list when the member has none", () => {
    setup({ ...baseMe, studies: [] });
    expect(screen.queryByRole("list", { name: "내 스터디" })).toBeNull();
  });

  it("opens the drawer with aria-expanded and closes it with Escape, returning focus", async () => {
    const { user } = setup();
    const menuButton = screen.getByRole("button", { name: "메뉴 열기" });
    expect(menuButton).toHaveAttribute("aria-expanded", "false");

    await user.click(menuButton);
    const drawer = screen.getByRole("dialog", { name: "메뉴" });
    expect(menuButton).toHaveAttribute("aria-expanded", "true");
    expect(within(drawer).getByRole("link", { name: "DDIA" })).toBeInTheDocument();
    expect(drawer.contains(document.activeElement)).toBe(true);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "메뉴" })).toBeNull();
    expect(menuButton).toHaveAttribute("aria-expanded", "false");
    expect(menuButton).toHaveFocus();
  });

  it("closes the drawer on an outside click and keeps Tab inside it", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "메뉴 열기" }));
    const drawer = screen.getByRole("dialog", { name: "메뉴" });
    // Tab cycles within the drawer.
    for (let i = 0; i < 10; i++) {
      await user.tab();
      expect(drawer.contains(document.activeElement)).toBe(true);
    }
    await user.click(screen.getByTestId("drawer-scrim"));
    expect(screen.queryByRole("dialog", { name: "메뉴" })).toBeNull();
  });

  it("closes the drawer after navigating from it", async () => {
    const { user, router } = setup();
    await user.click(screen.getByRole("button", { name: "메뉴 열기" }));
    await user.click(within(screen.getByRole("dialog", { name: "메뉴" })).getByRole("link", { name: "지식" }));
    expect(router.state.location.pathname).toBe("/posts");
    expect(screen.queryByRole("dialog", { name: "메뉴" })).toBeNull();
  });

  it('"/" focuses the search and Enter goes to /posts?q=', async () => {
    const { user, router } = setup();
    await user.keyboard("/");
    const search = await waitFor(() => {
      const el = document.activeElement;
      expect(el).toHaveAttribute("type", "search");
      return el as HTMLInputElement;
    });
    await user.type(search, "훅 정리{Enter}");
    expect(router.state.location.pathname).toBe("/posts");
    expect(new URLSearchParams(router.state.location.search).get("q")).toBe("훅 정리");
  });

  it("shows 카테고리 관리 in the avatar menu only for admins", async () => {
    const { user } = setup({ ...baseMe, isAdmin: true });
    const [avatar] = screen.getAllByRole("button", { name: "내 계정 메뉴" });
    await user.click(avatar!);
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "내 정보" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "카테고리 관리" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "로그아웃" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(avatar).toHaveFocus();
  });
});
