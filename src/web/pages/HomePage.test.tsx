import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Home } from "../../shared/api";
import { queryKeys } from "../lib/endpoints";
import { renderRoutes, testMe } from "../test/render";
import { HomePage } from "./HomePage";

const home: Home = {
  nextMeetings: [
    {
      roundId: "r5",
      studyId: "s1",
      studyName: "DDIA",
      seq: 5,
      title: "6장 파티셔닝",
      scope: "6장",
      location: "Discord 음성 채널",
      meetingAt: Date.parse("2026-10-08T12:00:00Z"), // Thu 21:00 KST
      roundStatus: "active",
      linkedPostCount: 3,
    },
  ],
  recentPosts: [],
};

describe("HomePage", () => {
  it("lists this week's meetings with weekday/time, study · round · place and linked posts", () => {
    renderRoutes([{ path: "/", element: <HomePage /> }], "/", {
      me: { ...testMe, studies: [{ id: "s1", name: "DDIA", status: "active" }] },
      data: [[queryKeys.home, home]],
    });
    const row = screen.getByRole("link", { name: /6장 파티셔닝/ });
    expect(row).toHaveAttribute("href", "/rounds/r5");
    expect(within(row).getByText("목요일")).toBeInTheDocument();
    expect(within(row).getByText("21:00")).toBeInTheDocument();
    expect(within(row).getByText(/DDIA · 5회차 · Discord 음성 채널/)).toBeInTheDocument();
    expect(within(row).getByText("연결된 글 3")).toBeInTheDocument();
  });

  it("shows an empty state when there are no meetings", () => {
    renderRoutes([{ path: "/", element: <HomePage /> }], "/", { data: [[queryKeys.home, { ...home, nextMeetings: [] }]] });
    expect(screen.getByText(/참여 중인 스터디가 없습니다/)).toBeInTheDocument();
    expect(screen.getByText("아직 공유된 글이 없습니다.")).toBeInTheDocument();
  });
});
