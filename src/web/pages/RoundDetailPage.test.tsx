import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Round, RoundDetail } from "../../shared/api";
import { NOTES_DRAFT_KIND } from "../components/RoundNotes";
import { loadKeyedDraft } from "../lib/drafts";
import { queryKeys } from "../lib/endpoints";
import { json, renderRoutes, stubFetch, testMe } from "../test/render";
import { RoundDetailPage } from "./RoundDetailPage";

const other = { id: "m2", displayName: "민지", avatarUrl: null, withdrawn: false };

const baseRound: Round = {
  id: "0190a000-0000-7000-8000-000000000005",
  studyId: "s1",
  seq: 5,
  title: "6장 파티셔닝",
  scope: "6장 전체",
  goal: "파티셔닝 전략을 이해한다",
  periodStart: "2026-10-03",
  periodEnd: "2026-10-09",
  meetingAt: Date.parse("2026-10-08T12:00:00Z"),
  location: "https://discord.gg/abc",
  materials: null,
  status: "active",
  infoVersion: 1,
  infoUpdatedBy: null,
  infoUpdatedAt: null,
  notesDiscussion: "처음 논의",
  notesOpenQuestions: null,
  notesNextActions: null,
  notesVersion: 3,
  notesUpdatedBy: other,
  notesUpdatedAt: Date.now() - 3_600_000,
  createdBy: other,
  createdAt: Date.now() - 86_400_000,
};

const detail = (over: Partial<RoundDetail> = {}): RoundDetail => ({
  ...baseRound,
  study: { id: "s1", name: "DDIA", status: "active", hidden: false },
  isMember: true,
  posts: [],
  comments: [],
  previous: {
    id: "r4",
    seq: 4,
    title: "5장",
    notesOpenQuestions: "복제 지연 측정은?",
    notesNextActions: "연습문제 1개 정리",
  },
  permissions: {
    canEditInfo: true,
    canWriteNotes: true,
    canSetStatus: true,
    canDelete: true,
    canLink: true,
    canComment: true,
  },
  ...over,
});

function setup(round = detail()) {
  return renderRoutes(
    [
      { path: "/rounds/:id", element: <RoundDetailPage /> },
      { path: "/studies/:id", element: <p>스터디 화면</p> },
    ],
    `/rounds/${round.id}`,
    { data: [[queryKeys.round(round.id), round]] },
  );
}

describe("RoundDetailPage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows meta, info panel, carry-over and the write link", () => {
    const r = detail();
    setup(r);
    expect(screen.getByText(/5회차 · 진행 중/)).toBeInTheDocument();
    const panel = screen.getByRole("complementary", { name: "회차 정보" });
    expect(within(panel).getByText("10월 8일 (목) 21:00")).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "https://discord.gg/abc" })).toHaveAttribute("target", "_blank");
    expect(within(panel).getByText("10월 3일 – 10월 9일")).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "4회차 기록 보기" })).toHaveAttribute("href", "/rounds/r4");
    expect(screen.getByRole("link", { name: /이 회차에 글 쓰기/ })).toHaveAttribute("href", `/posts/new?roundId=${r.id}`);
  });

  it("on a notes conflict shows latest vs mine side by side, keeps my input and resaves on the latest version", async () => {
    const latest: Round = {
      ...baseRound,
      notesDiscussion: "민지가 먼저 저장한 논의",
      notesOpenQuestions: "새 질문",
      notesVersion: 4,
      notesUpdatedBy: other,
      notesUpdatedAt: Date.now(),
    };
    const bodies: Record<string, unknown>[] = [];
    const spy = stubFetch((url, init) => {
      if (url === `/api/rounds/${baseRound.id}/notes` && init?.method === "PATCH") {
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        bodies.push(body);
        if (body.notesVersion === 3) {
          return json(409, { error: { code: "VERSION_CONFLICT", message: "다른 멤버가 먼저 저장했습니다", latest } });
        }
        return json(200, { ...latest, notesDiscussion: body.notesDiscussion, notesVersion: 5 });
      }
      if (url === `/api/rounds/${baseRound.id}`) return json(200, detail({ notesVersion: 5 }));
      return undefined;
    });
    const { user } = setup();

    await user.click(screen.getByRole("button", { name: "기록 편집" }));
    const discussion = screen.getByRole("textbox", { name: /핵심 논의/ });
    await user.clear(discussion);
    await user.type(discussion, "내가 쓴 논의");
    await user.click(screen.getByRole("button", { name: "기록 저장" }));

    expect(await screen.findByText("다른 멤버가 먼저 저장했습니다.")).toBeInTheDocument();
    expect(within(screen.getByTestId("latest-notesDiscussion")).getByText("민지가 먼저 저장한 논의")).toBeInTheDocument();
    expect(within(screen.getByTestId("latest-notesOpenQuestions")).getByText("새 질문")).toBeInTheDocument();
    // My input is still there and editable.
    expect(screen.getByRole("textbox", { name: /핵심 논의/ })).toHaveValue("내가 쓴 논의");
    // The local draft now points at the latest version.
    expect(loadKeyedDraft(testMe.id, NOTES_DRAFT_KIND, baseRound.id)).toMatchObject({
      baseVersion: 4,
      values: { notesDiscussion: "내가 쓴 논의" },
    });

    await user.type(screen.getByRole("textbox", { name: /핵심 논의/ }), " + 합침");
    await user.click(screen.getByRole("button", { name: "합쳐서 저장" }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[0]).toMatchObject({ notesVersion: 3, notesDiscussion: "내가 쓴 논의" });
    expect(bodies[1]).toMatchObject({ notesVersion: 4, notesDiscussion: "내가 쓴 논의 + 합침" });
    await waitFor(() => expect(loadKeyedDraft(testMe.id, NOTES_DRAFT_KIND, baseRound.id)).toBeNull());
    expect(spy).toHaveBeenCalled();
  });

  it("autosaves notes to a draft and restores it on reopen", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "기록 편집" }));
    await user.type(screen.getByRole("textbox", { name: /다음 행동/ }), "각자 7장 읽기");
    await waitFor(() =>
      expect(loadKeyedDraft(testMe.id, NOTES_DRAFT_KIND, baseRound.id)).toMatchObject({
        baseVersion: 3,
        values: { notesNextActions: "각자 7장 읽기" },
      }),
    );
  });

  it("explains ROUND_NOT_EMPTY when deleting", async () => {
    stubFetch((url, init) => {
      if (url === `/api/rounds/${baseRound.id}` && init?.method === "DELETE") {
        return json(409, { error: { code: "ROUND_NOT_EMPTY", message: "x" } });
      }
      return undefined;
    });
    const { user, router } = setup();
    await user.click(screen.getByRole("button", { name: "회차 삭제" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByRole("button", { name: "취소" })).toHaveFocus();
    await user.click(within(dialog).getByRole("button", { name: "삭제" }));
    expect(await within(dialog).findByText("연결된 글, 댓글 또는 모임 기록이 있는 회차는 삭제할 수 없습니다.")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/rounds/${baseRound.id}`);
  });

  it("is read-only when ended but still allows comments", () => {
    setup(
      detail({
        status: "ended",
        permissions: {
          canEditInfo: false,
          canWriteNotes: false,
          canSetStatus: true,
          canDelete: false,
          canLink: false,
          canComment: true,
        },
      }),
    );
    expect(screen.getByText(/종료된 회차입니다/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "기록 편집" })).toBeNull();
    expect(screen.queryByRole("link", { name: "회차 정보 편집" })).toBeNull();
    expect(screen.getByRole("button", { name: "회차 재개" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "댓글 등록" })).toBeInTheDocument();
  });
});
