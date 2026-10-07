import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { CategoryTabsModel } from "../lib/categoryTabs";
import { CategoryTabs } from "./CategoryTabs";

const model: CategoryTabsModel = {
  tabs: [
    { id: null, name: "전체", count: 40 },
    { id: "a", name: "프론트엔드", count: 20 },
    { id: "b", name: "백엔드", count: 10 },
  ],
  more: [
    { id: "c", name: "운영체제", count: 6 },
    { id: "d", name: "클라우드 운영", count: 3 },
    { id: "e", name: "보안", count: 1 },
  ],
};

function setup(onSelect = vi.fn()) {
  const router = createMemoryRouter(
    [
      {
        path: "/posts",
        element: (
          <CategoryTabs model={model} selectedId="a" hrefFor={(id) => (id ? `/posts?category=${id}` : "/posts")} onSelect={onSelect} />
        ),
      },
    ],
    { initialEntries: ["/posts"] },
  );
  render(<RouterProvider router={router} />);
  return { user: userEvent.setup(), onSelect };
}

describe("CategoryTabs (UD-14)", () => {
  it("renders 전체 first with counts and marks the selected tab", () => {
    setup();
    const nav = screen.getByRole("navigation", { name: "카테고리" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["전체40", "프론트엔드20", "백엔드10"]);
    expect(links[1]).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: /더 보기 3/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("Escape closes the popover and returns focus to the trigger", async () => {
    const { user } = setup();
    const trigger = screen.getByRole("button", { name: /더 보기 3/ });
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const search = screen.getByRole("combobox", { name: "카테고리 검색" });
    expect(search).toHaveFocus();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["운영체제글 6", "클라우드 운영글 3", "보안글 1"]);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "다른 카테고리" })).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("filters with the search box and picks with arrow keys + Enter", async () => {
    const { user, onSelect } = setup();
    const trigger = screen.getByRole("button", { name: /더 보기/ });
    await user.click(trigger);
    await user.keyboard("운영");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: /클라우드 운영/ })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("d");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("closes on an outside click", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /더 보기/ }));
    await user.click(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
