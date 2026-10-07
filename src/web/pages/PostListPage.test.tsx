import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CategoryList, Page, PostListItem } from "../../shared/api";
import { PostListPage } from "./PostListPage";

const cats: CategoryList = {
  items: [
    { id: "c1", name: "프론트엔드", archived: false, createdAt: 1, postCount: 5 },
    { id: "c2", name: "백엔드", archived: false, createdAt: 1, postCount: 2 },
    { id: "c3", name: "옛날", archived: true, createdAt: 1, postCount: 1 },
  ],
  totalPosts: 8,
};
const post: PostListItem = {
  id: "p1",
  title: "React 훅 정리",
  excerpt: "useActionState 요약",
  category: { id: "c1", name: "프론트엔드" },
  author: { id: "m1", displayName: "테스터", avatarUrl: null, withdrawn: false },
  tags: ["react", "hooks"],
  roundId: null,
  round: null,
  commentCount: 2,
  hidden: false,
  createdAt: Date.now() - 60_000 * 5,
  updatedAt: Date.now(),
};

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

function setup(path: string) {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "/api/categories") return Promise.resolve(json(cats));
    if (url.startsWith("/api/posts")) return Promise.resolve(json({ items: [post], nextCursor: null } satisfies Page<PostListItem>));
    return Promise.reject(new Error(`unexpected ${url}`));
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: "/posts", element: <PostListPage /> }], { initialEntries: [path] });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, fetchSpy, user: userEvent.setup() };
}

describe("PostListPage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows tabs with counts, a row with excerpt and meta", async () => {
    setup("/posts");
    const nav = await screen.findByRole("navigation", { name: "카테고리" });
    expect(within(nav).getAllByRole("link").map((l) => l.textContent)).toEqual(["전체8", "프론트엔드5", "백엔드2"]);
    expect(await screen.findByRole("link", { name: "React 훅 정리" })).toHaveAttribute("href", "/posts/p1");
    expect(screen.getByText("useActionState 요약")).toBeInTheDocument();
    expect(screen.getByText("#react #hooks")).toBeInTheDocument();
    expect(screen.getByText("댓글 2")).toBeInTheDocument();
    expect(screen.getByText("글 8개")).toBeInTheDocument();
  });

  it("summarises a search and removes the tag filter with its chip", async () => {
    const { router, fetchSpy, user } = setup("/posts?category=c1&q=%ED%9B%85&tag=react");
    expect(await screen.findByText("프론트엔드 · #react · '훅' 검색 결과 1건")).toBeInTheDocument();
    expect(fetchSpy.mock.calls.some(([u]) => u === "/api/posts?q=%ED%9B%85&category=c1&tag=react")).toBe(true);
    await user.click(screen.getByRole("button", { name: "태그 react 필터 해제" }));
    expect(new URLSearchParams(router.state.location.search).get("tag")).toBeNull();
    expect(new URLSearchParams(router.state.location.search).get("q")).toBe("훅");
  });

  it("adds a tag filter with + 태그", async () => {
    const { router, user } = setup("/posts");
    await user.click(await screen.findByRole("button", { name: "+ 태그" }));
    await user.type(screen.getByLabelText("태그로 거르기"), "#react{Enter}");
    expect(new URLSearchParams(router.state.location.search).get("tag")).toBe("react");
  });
});
