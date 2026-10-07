import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CategoryWithCount, LinkableRound, Me, PostDetail } from "../../shared/api";
import { renderRoutes, stubFetch } from "../test/render";
import { latestNewPostDraft, saveDraft } from "../lib/drafts";
import { queryKeys } from "../lib/endpoints";
import { SessionContext } from "../lib/session";
import { emptyPostValues, PostEditorPage } from "./PostEditorPage";

const me: Me = { id: "0190a000-0000-7000-8000-0000000000aa", displayName: "tester", avatarUrl: null, isAdmin: false, studies: [] };
const categories: CategoryWithCount[] = [
  { id: "0190a000-0000-7000-8000-0000000000c1", name: "기타", archived: false, createdAt: 1, postCount: 3 },
  { id: "0190a000-0000-7000-8000-0000000000c2", name: "옛날", archived: true, createdAt: 1, postCount: 1 },
];

const linkable: LinkableRound[] = [
  { id: "0190a000-0000-7000-8000-0000000000b1", seq: 5, title: "6장 파티셔닝", studyId: "s1", studyName: "DDIA" },
  { id: "0190a000-0000-7000-8000-0000000000b2", seq: 3, title: "Pod 설계", studyId: "s2", studyName: "CKAD" },
];

function setup(path = "/posts/new") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  queryClient.setQueryData(queryKeys.categories, categories);
  queryClient.setQueryData(queryKeys.linkableRounds, linkable);
  const router = createMemoryRouter(
    [
      { path: "/posts/new", element: <PostEditorPage mode="new" /> },
      { path: "/posts/:id", element: <p>상세 화면</p> },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <SessionContext.Provider value={me}>
        <RouterProvider router={router} />
      </SessionContext.Provider>
    </QueryClientProvider>,
  );
  return { router, user: userEvent.setup() };
}

/** fetch stub whose POST /api/posts response is resolved by the test. */
function deferredPostFetch() {
  let resolve!: (r: Response) => void;
  const pending = new Promise<Response>((r) => (resolve = r));
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "/api/posts" && init?.method === "POST") return pending;
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  });
  return { spy, resolve };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/제목/), "React 훅 정리");
  await user.selectOptions(screen.getByLabelText(/카테고리/, { selector: "select" }), categories[0]!.id);
  await user.type(screen.getByRole("textbox", { name: /본문/ }), "본문 내용");
}

describe("PostEditorPage (new)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not offer archived categories", () => {
    setup();
    const select = screen.getByLabelText(/카테고리/, { selector: "select" });
    expect(select).toHaveTextContent("기타");
    expect(select).not.toHaveTextContent("옛날");
  });

  it("disables submit while pending and keeps input + shows field errors on 422", async () => {
    const { spy, resolve } = deferredPostFetch();
    const { router, user } = setup();
    await fillValidForm(user);

    const submit = screen.getByRole("button", { name: "등록" });
    await user.click(submit);
    await waitFor(() => expect(screen.getByRole("button", { name: "저장 중…" })).toBeDisabled());
    // A second click while pending does not send another request.
    await user.click(screen.getByRole("button", { name: "저장 중…" }));
    expect(spy).toHaveBeenCalledTimes(1);

    const sent = JSON.parse(spy.mock.calls[0]![1]!.body as string) as Record<string, unknown>;
    expect(typeof sent.id).toBe("string");
    expect(sent).toEqual({
      id: sent.id,
      title: "React 훅 정리",
      body: "본문 내용",
      categoryId: categories[0]!.id,
      tags: [],
      links: [],
    });

    resolve(json(422, { error: { code: "VALIDATION", message: "입력값을 확인하세요", fields: { title: ["서버가 거부한 제목입니다"] } } }));

    expect(await screen.findByText("서버가 거부한 제목입니다")).toBeInTheDocument();
    expect(screen.getByLabelText(/제목/)).toHaveValue("React 훅 정리");
    expect(screen.getByRole("textbox", { name: /본문/ })).toHaveValue("본문 내용");
    expect(screen.getByRole("button", { name: "등록" })).toBeEnabled();
    expect(router.state.location.pathname).toBe("/posts/new");
  });

  it("keeps input and shows the message on a server error, never success", async () => {
    const { resolve } = deferredPostFetch();
    const { router, user } = setup();
    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "등록" }));
    resolve(json(500, { error: { code: "INTERNAL", message: "서버 오류가 발생했습니다 (abc)" } }));

    expect(await screen.findByText(/저장하지 못했습니다: 서버 오류가 발생했습니다 \(abc\)/)).toBeInTheDocument();
    expect(screen.getByLabelText(/제목/)).toHaveValue("React 훅 정리");
    expect(screen.queryByText("상세 화면")).toBeNull();
    expect(router.state.location.pathname).toBe("/posts/new");
    // The draft is still in localStorage for later.
    await waitFor(() => expect(latestNewPostDraft(me.id)?.values).toMatchObject({ title: "React 훅 정리" }));
  });

  it("validates on the client before sending (category and link URL)", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const { user } = setup();
    await user.type(screen.getByLabelText(/제목/), "제목");
    await user.type(screen.getByRole("textbox", { name: /본문/ }), "본문");
    await user.click(screen.getByRole("button", { name: "+ 링크 추가" }));
    await user.type(screen.getByLabelText("링크 1 주소"), "javascript:alert(1)");
    await user.click(screen.getByRole("button", { name: "등록" }));
    expect(await screen.findByText("http 또는 https 주소만 허용됩니다")).toBeInTheDocument();
    expect(screen.getByLabelText(/카테고리/, { selector: "select" })).toHaveAttribute("aria-invalid", "true");
    expect(spy).not.toHaveBeenCalled();
  });

  it("has no post kind or question fields (D-22)", () => {
    setup();
    expect(screen.queryByText("글 종류")).toBeNull();
    expect(screen.queryByLabelText("자료")).toBeNull();
    expect(screen.queryByText("해결 상태")).toBeNull();
    expect(screen.queryByLabelText(/추천 이유/)).toBeNull();
  });

  it("navigates to the post and clears the draft on success", async () => {
    const { resolve } = deferredPostFetch();
    const { router, user } = setup();
    await fillValidForm(user);
    await waitFor(() => expect(latestNewPostDraft(me.id)).not.toBeNull());
    await user.click(screen.getByRole("button", { name: "등록" }));
    const sent = latestNewPostDraft(me.id)!;
    resolve(json(201, { id: sent.postId }));
    expect(await screen.findByText("상세 화면")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/posts/${sent.postId}`);
    expect(latestNewPostDraft(me.id)).toBeNull();
  });

  it("restores the latest unsent draft on reopen", () => {
    saveDraft(me.id, {
      mode: "new",
      postId: "0190a000-0000-7000-8000-0000000000dd",
      savedAt: Date.now(),
      values: { ...emptyPostValues(), title: "이어서 쓰던 글", body: "초안" },
    });
    setup();
    expect(screen.getByLabelText(/제목/)).toHaveValue("이어서 쓰던 글");
    expect(screen.getByText(/임시저장된 내용을 불러왔습니다/)).toBeInTheDocument();
  });

  it("offers my linkable rounds grouped by study, none selected by default", () => {
    setup();
    const select = screen.getByLabelText(/회차 연결/);
    expect(select).toHaveValue("");
    expect(within(select).getByRole("option", { name: "연결 안 함" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "5회차 · 6장 파티셔닝" })).toBeInTheDocument();
    expect(within(select).getByRole("group", { name: "CKAD" })).toBeInTheDocument();
  });

  it("prefills the round from ?roundId= and sends it on create", async () => {
    const { spy } = deferredPostFetch();
    const { user } = setup(`/posts/new?roundId=${linkable[0]!.id}`);
    expect(screen.getByLabelText(/회차 연결/)).toHaveValue(linkable[0]!.id);
    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "등록" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const sent = JSON.parse(spy.mock.calls[0]![1]!.body as string) as Record<string, unknown>;
    expect(sent.roundId).toBe(linkable[0]!.id);
  });

  it("does not send a prefilled round that is not linkable", async () => {
    const { spy } = deferredPostFetch();
    const { user } = setup("/posts/new?roundId=0190a000-0000-7000-8000-0000000000ff");
    expect(screen.getByText(/이 회차에는 글을 연결할 수 없습니다/)).toBeInTheDocument();
    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "등록" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const sent = JSON.parse(spy.mock.calls[0]![1]!.body as string) as Record<string, unknown>;
    expect(sent).not.toHaveProperty("roundId");
  });
});

describe("PostEditorPage: HTML file (D-30)", () => {
  afterEach(() => vi.restoreAllMocks());

  const htmlFile = (content: string, name = "hooks.html") => new File([content], name, { type: "text/html" });

  it("prefills title from <title> and the required body, and sends the file inside POST /api/posts", async () => {
    const { spy, resolve } = deferredPostFetch();
    const { user } = setup();
    await user.upload(screen.getByLabelText("HTML 파일 선택"), htmlFile("<title>훅 총정리</title><p>본문</p>"));
    expect(await screen.findByTestId("html-attached")).toHaveTextContent("hooks.html");
    expect(screen.getByLabelText(/제목/)).toHaveValue("훅 총정리");
    expect(screen.getByRole("textbox", { name: /본문/ })).toHaveValue("HTML 파일로 정리한 내용입니다.");
    expect(screen.getByText(/짧은 소개를 넣어 두었습니다/)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/카테고리/, { selector: "select" }), categories[0]!.id);
    await user.click(screen.getByRole("button", { name: "등록" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const sent = JSON.parse(spy.mock.calls[0]![1]!.body as string) as Record<string, unknown>;
    expect(sent.html).toEqual({ filename: "hooks.html", html: "<title>훅 총정리</title><p>본문</p>" });
    expect(sent.title).toBe("훅 총정리");
    resolve(json(201, { id: sent.id }));
    expect(await screen.findByText("상세 화면")).toBeInTheDocument();
  });

  it("falls back to the file name for the title and keeps a typed title", async () => {
    const { user } = setup();
    await user.upload(screen.getByLabelText("HTML 파일 선택"), htmlFile("<p>x</p>", "deep-dive.htm"));
    await waitFor(() => expect(screen.getByLabelText(/제목/)).toHaveValue("deep-dive"));
    await user.click(screen.getByRole("button", { name: "제거" }));
    await user.clear(screen.getByLabelText(/제목/));
    await user.type(screen.getByLabelText(/제목/), "내 제목");
    await user.upload(screen.getByLabelText("HTML 파일 선택"), htmlFile("<title>다른 제목</title>"));
    await screen.findByTestId("html-attached");
    expect(screen.getByLabelText(/제목/)).toHaveValue("내 제목");
  });

  it("shows a clear error for a non-UTF-8 file and attaches nothing", async () => {
    const { user } = setup();
    await user.upload(
      screen.getByLabelText("HTML 파일 선택"),
      new File([new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb])], "euckr.html", { type: "text/html" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("UTF-8로 저장된 HTML 파일만 올릴 수 있습니다");
    expect(screen.queryByTestId("html-attached")).toBeNull();
  });

  it("keeps only the file name in the draft and asks for the file again", async () => {
    const { user } = setup();
    await user.upload(screen.getByLabelText("HTML 파일 선택"), htmlFile("<title>t</title>"));
    await waitFor(() => expect(latestNewPostDraft<{ htmlFilename: string }>(me.id)?.values.htmlFilename).toBe("hooks.html"));
    expect(JSON.stringify(latestNewPostDraft(me.id))).not.toContain("<title>");
  });
});

describe("PostEditorPage (edit) with HTML", () => {
  afterEach(() => vi.restoreAllMocks());

  const postId = "0190a000-0000-7000-8000-0000000000e1";
  const detail: PostDetail = {
    id: postId,
    title: "기존 글",
    body: "소개",
    category: { id: categories[0]!.id, name: "기타", archived: false },
    author: { id: me.id, displayName: "tester", avatarUrl: null, withdrawn: false },
    tags: [],
    links: [],
    roundId: null,
    round: null,
    html: { filename: "old.html", size: 2048, uploadedAt: 1 },
    hidden: false,
    createdAt: 1,
    updatedAt: 2,
    comments: [],
  };

  function setupEdit() {
    return renderRoutes(
      [
        { path: "/posts/:id/edit", element: <PostEditorPage mode="edit" /> },
        { path: "/posts/:id", element: <p>상세 화면</p> },
      ],
      `/posts/${postId}/edit`,
      {
        me,
        data: [
          [queryKeys.post(postId), detail],
          [queryKeys.categories, categories],
        ],
      },
    );
  }

  it("saves the text first, then PUTs the new file", async () => {
    const calls: string[] = [];
    stubFetch((url, init) => {
      calls.push(`${init?.method} ${url}`);
      if (init?.method === "PATCH") return json(200, { ...detail, title: "새 제목" });
      if (init?.method === "PUT") return json(200, { ...detail, html: { filename: "new.html", size: 10, uploadedAt: 3 } });
      return undefined;
    });
    const { user, router } = setupEdit();
    expect(screen.getByTestId("html-attached")).toHaveTextContent("old.html");
    await user.upload(screen.getByLabelText("HTML 파일 선택"), new File(["<p>new</p>"], "new.html"));
    await screen.findByText(/저장하면 바뀝니다/);
    await user.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/posts/${postId}`));
    expect(calls).toEqual([`PATCH /api/posts/${postId}`, `PUT /api/posts/${postId}/html`]);
  });

  it("keeps the form and the file when the file step fails, and says which step failed", async () => {
    const bodies: unknown[] = [];
    stubFetch((url, init) => {
      if (init?.method === "PATCH") return json(200, detail);
      if (init?.method === "PUT") {
        bodies.push(JSON.parse(init.body as string));
        return json(500, { error: { code: "INTERNAL", message: "서버 오류 (x1)" } });
      }
      return undefined;
    });
    const { user, router } = setupEdit();
    await user.clear(screen.getByLabelText(/제목/));
    await user.type(screen.getByLabelText(/제목/), "고친 제목");
    await user.upload(screen.getByLabelText("HTML 파일 선택"), new File(["<p>new</p>"], "new.html"));
    await screen.findByText(/저장하면 바뀝니다/);
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText(/글 내용은 저장했지만 HTML 파일을 올리지 못했습니다: 서버 오류 \(x1\)/)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/posts/${postId}/edit`);
    expect(screen.getByLabelText(/제목/)).toHaveValue("고친 제목");
    expect(screen.getByTestId("html-attached")).toHaveTextContent("new.html");
    expect(bodies).toEqual([{ filename: "new.html", html: "<p>new</p>" }]);
  });

  it("removes the file with DELETE after saving", async () => {
    const calls: string[] = [];
    stubFetch((url, init) => {
      calls.push(`${init?.method} ${url}`);
      if (init?.method === "PATCH") return json(200, detail);
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return undefined;
    });
    const { user, router } = setupEdit();
    await user.click(screen.getByRole("button", { name: "제거" }));
    expect(screen.getByText(/저장하면 HTML 파일이 삭제됩니다/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/posts/${postId}`));
    expect(calls).toEqual([`PATCH /api/posts/${postId}`, `DELETE /api/posts/${postId}/html`]);
  });
});
