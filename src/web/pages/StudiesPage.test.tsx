import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StudyDetail, StudyListItem } from "../../shared/api";
import { queryKeys } from "../lib/endpoints";
import { json, renderRoutes, stubFetch, testMe } from "../test/render";
import { StudiesPage } from "./StudiesPage";
import { StudyFormPage } from "./StudyFormPage";

const item = (over: Partial<StudyListItem>): StudyListItem => ({
  id: "s",
  name: "스터디",
  goal: "목표",
  cadence: null,
  status: "active",
  hidden: false,
  isMember: false,
  memberCount: 3,
  latestRound: null,
  nextMeeting: null,
  ...over,
});

const list: StudyListItem[] = [
  item({
    id: "s1",
    name: "DDIA",
    isMember: true,
    memberCount: 6,
    latestRound: { id: "r5", seq: 5, title: "파티셔닝", meetingAt: null, status: "active" },
  }),
  item({ id: "s2", name: "AI Engineering", cadence: "매주 화 21시" }),
  item({ id: "s3", name: "CKAD", isMember: false }),
  item({ id: "s4", name: "옛 스터디", status: "ended", isMember: true }),
  item({ id: "s5", name: "오래된 스터디", status: "ended" }),
];

const detail = (id: string, joinGuide: string | null) =>
  ({ id, joinGuide, name: "x", permissions: { canEdit: false, canCreateRound: false, canManage: false } }) as unknown as StudyDetail;

const routes = [
  { path: "/studies", element: <StudiesPage /> },
  { path: "/studies/new", element: <StudyFormPage mode="new" /> },
];

describe("StudiesPage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("groups my studies, joinable ones and ended ones", async () => {
    const { user } = renderRoutes(routes, "/studies", { data: [[queryKeys.studyList, list]] });
    const mine = screen.getByRole("heading", { name: "내 스터디" }).closest("section")!;
    expect(within(mine).getByRole("link", { name: /DDIA/ })).toHaveAttribute("href", "/studies/s1");
    expect(within(mine).getByText("멤버 6 · 5회차 진행 중")).toBeInTheDocument();
    expect(within(mine).queryByText("AI Engineering")).toBeNull();

    const joinable = screen.getByRole("heading", { name: "참여할 수 있는 스터디" }).closest("section")!;
    expect(within(joinable).getAllByRole("button", { name: /참여 방법/ })).toHaveLength(2);
    expect(within(joinable).getByText("멤버 3 · 아직 회차 없음 · 매주 화 21시")).toBeInTheDocument();

    // Ended studies are behind a disclosure.
    expect(screen.queryByText("옛 스터디")).toBeNull();
    const toggle = screen.getByRole("button", { name: /종료된 스터디 2개 보기/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(screen.getByText("옛 스터디")).toBeInTheDocument();
    expect(screen.getByText("오래된 스터디")).toBeInTheDocument();
  });

  it("toggles the join guide (Markdown) and falls back to 운영진에게 문의", async () => {
    stubFetch((url) => {
      if (url === "/api/studies/s2") return json(200, detail("s2", "Discord **#스터디-신청** 채널에서 역할을 받으세요"));
      if (url === "/api/studies/s3") return json(200, detail("s3", null));
      return undefined;
    });
    const { user } = renderRoutes(routes, "/studies", { data: [[queryKeys.studyList, list]] });
    const [aiButton, ckadButton] = screen.getAllByRole("button", { name: /참여 방법/ });
    await user.click(aiButton!);
    expect(aiButton).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText("#스터디-신청")).toBeInTheDocument();
    await user.click(aiButton!);
    expect(aiButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("#스터디-신청")).toBeNull();

    await user.click(ckadButton!);
    expect(await screen.findByText(/운영진에게 문의하세요/)).toBeInTheDocument();
  });

  it("shows 스터디 만들기 only to admins", () => {
    renderRoutes(routes, "/studies", { data: [[queryKeys.studyList, list]] });
    expect(screen.queryByRole("link", { name: /스터디 만들기/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Discord 역할 새로고침" })).toBeInTheDocument();
  });

  it("admin sees the create link", () => {
    renderRoutes(routes, "/studies", { me: { ...testMe, isAdmin: true }, data: [[queryKeys.studyList, list]] });
    expect(screen.getByRole("link", { name: /스터디 만들기/ })).toHaveAttribute("href", "/studies/new");
  });
});

describe("StudyFormPage (create)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is admin-only", () => {
    renderRoutes(routes, "/studies/new");
    expect(screen.getByText("운영자만 스터디를 만들 수 있습니다.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Discord 역할 ID/)).toBeNull();
  });

  it("validates the Discord role id and names the study that already uses it", async () => {
    const spy = stubFetch((url, init) => {
      if (url === "/api/studies" && init?.method === "POST") {
        return json(409, { error: { code: "DUPLICATE", message: "dup", existing: { id: "s9", name: "DDIA" } } });
      }
      return undefined;
    });
    const { user } = renderRoutes(routes, "/studies/new", { me: { ...testMe, isAdmin: true } });
    await user.type(screen.getByLabelText(/^이름/), "새 스터디");
    await user.type(screen.getByLabelText(/^목표/), "같이 공부");
    const role = screen.getByLabelText(/Discord 역할 ID/);
    expect(screen.getByText(/역할 우클릭 → ID 복사/)).toBeInTheDocument();

    await user.type(role, "12345");
    await user.click(screen.getByRole("button", { name: "만들기" }));
    expect(await screen.findByText("Discord 역할 ID(17~20자리 숫자)를 입력하세요")).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();

    await user.clear(role);
    await user.type(role, "1551814006254211143");
    await user.click(screen.getByRole("button", { name: "만들기" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect((await screen.findAllByText('이 Discord 역할은 이미 "DDIA" 스터디에 연결되어 있습니다.')).length).toBeGreaterThan(0);
    const sent = JSON.parse(spy.mock.calls[0]![1]!.body as string) as Record<string, unknown>;
    expect(sent).toMatchObject({ name: "새 스터디", goal: "같이 공부", discordRoleId: "1551814006254211143" });
    expect(typeof sent.id).toBe("string");
  });
});
