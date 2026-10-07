import { focusManager } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PostDetail } from "../../shared/api";
import { queryKeys } from "../lib/endpoints";
import { PostDetailPage } from "../pages/PostDetailPage";
import { json, renderRoutes, stubFetch, testMe } from "../test/render";
import { HTML_FRAME_SANDBOX, PostHtmlFrame } from "./PostHtmlFrame";

const meta = { filename: "hooks.html", size: 312_400, uploadedAt: 1 };
const signed = (n: number) => `http://localhost:8788/v/p1?exp=${n}&sig=abc${n}`;

describe("PostHtmlFrame (TD-26)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    act(() => focusManager.setFocused(undefined));
  });

  it("embeds the signed URL with exactly the sandbox tokens (no allow-same-origin)", async () => {
    stubFetch((url) => (url === "/api/posts/p1/html-url" ? json(200, { url: signed(1), expiresAt: Date.now() + 3_600_000 }) : undefined));
    renderRoutes([{ path: "/", element: <PostHtmlFrame postId="p1" title="훅 정리" meta={meta} /> }], "/");
    const frame = await screen.findByTitle("훅 정리");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame).toHaveAttribute("src", signed(1));
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-popups allow-forms allow-modals allow-downloads");
    expect(frame.getAttribute("sandbox")).not.toMatch(/allow-same-origin|allow-top-navigation/);
    expect(HTML_FRAME_SANDBOX.split(" ").sort()).toEqual(["allow-downloads", "allow-forms", "allow-modals", "allow-popups", "allow-scripts"]);
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
    const open = screen.getByRole("link", { name: "전체 화면으로 열기" });
    expect(open).toHaveAttribute("href", signed(1));
    expect(open).toHaveAttribute("target", "_blank");
    expect(open.getAttribute("rel")).toContain("noopener");
    expect(open.getAttribute("rel")).toContain("noreferrer");
    expect(screen.getByText("hooks.html · 312KB")).toBeInTheDocument();
  });

  it("refetches the URL when the page regains focus near/after expiry, without reloading a loaded frame", async () => {
    let n = 0;
    const spy = stubFetch((url) => {
      if (url !== "/api/posts/p1/html-url") return undefined;
      n += 1;
      // The first URL is already inside the refresh margin.
      return json(200, { url: signed(n), expiresAt: Date.now() + (n === 1 ? 60_000 : 3_600_000) });
    });
    renderRoutes([{ path: "/", element: <PostHtmlFrame postId="p1" title="t" meta={meta} /> }], "/");
    const frame = await screen.findByTitle("t");
    fireEvent.load(frame);
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("link", { name: "전체 화면으로 열기" })).toHaveAttribute("href", signed(2)));
    // The reader's frame keeps its page.
    expect(screen.getByTitle("t")).toHaveAttribute("src", signed(1));
  });

  it("shows an error with retry when the URL cannot be fetched", async () => {
    stubFetch(() => json(404, { error: { code: "NOT_FOUND", message: "찾을 수 없습니다" } }));
    renderRoutes([{ path: "/", element: <PostHtmlFrame postId="p1" title="t" meta={meta} /> }], "/");
    expect(await screen.findByText("HTML 파일을 열지 못했습니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });

  it("toggles the height", async () => {
    stubFetch(() => json(200, { url: signed(1), expiresAt: Date.now() + 3_600_000 }));
    const { user } = renderRoutes([{ path: "/", element: <PostHtmlFrame postId="p1" title="t" meta={meta} /> }], "/");
    await screen.findByTitle("t");
    expect(screen.getByRole("button", { name: "높이 크게" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "높이 보통" }));
    expect(screen.getByRole("button", { name: "높이 보통" })).toHaveAttribute("aria-pressed", "true");
  });

  it("is shown above the intro on the post page, which widens the column", async () => {
    stubFetch(() => json(200, { url: signed(1), expiresAt: Date.now() + 3_600_000 }));
    const post: PostDetail = {
      id: "p1",
      title: "훅 정리",
      body: "짧은 소개",
      category: { id: "c1", name: "기타", archived: false },
      author: { id: "m2", displayName: "광윤", avatarUrl: null, withdrawn: false },
      tags: [],
      links: [],
      roundId: null,
      round: null,
      html: meta,
      hidden: false,
      createdAt: 1,
      updatedAt: 1,
      comments: [],
    };
    renderRoutes([{ path: "/posts/:id", element: <PostDetailPage /> }], "/posts/p1", {
      me: testMe,
      data: [[queryKeys.post("p1"), post]],
    });
    const frame = await screen.findByTitle("훅 정리");
    expect(frame.closest("article")).toHaveAttribute("data-wide");
    const intro = await screen.findByText("짧은 소개");
    expect(frame.compareDocumentPosition(intro) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
