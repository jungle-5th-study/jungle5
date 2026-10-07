// Home "this week" (PRD F-05/F-06, UI UD-08): my active studies' meetings in the current KST week.
import { describe, expect, it } from "vitest";
import { kstWeekRange } from "../../src/shared/time";
import { call, createPost, createRound, login, makeApp, setVerifiedAt, studySetup } from "../helpers";

/** UTC epoch ms of a KST wall-clock time. */
const kst = (iso: string) => Date.parse(`${iso}+09:00`);

describe("kstWeekRange", () => {
  it.each([
    ["2026-10-05T00:00:00", "2026-10-05T00:00:00"], // Monday 00:00 starts the week
    ["2026-10-07T12:00:00", "2026-10-05T00:00:00"],
    ["2026-10-11T23:59:59.999", "2026-10-05T00:00:00"], // Sunday 23:59 is still this week
    ["2026-10-12T00:00:00", "2026-10-12T00:00:00"], // next Monday 00:00 is the next week
    ["2026-10-04T23:59:59", "2026-09-28T00:00:00"],
  ])("KST %s → week of %s", (now, monday) => {
    const { start, end } = kstWeekRange(kst(now));
    expect(start).toBe(kst(monday));
    expect(end - start).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("GET /api/home nextMeetings", () => {
  it("includes Monday 00:00 through Sunday 23:59 KST, excludes next Monday 00:00; ascending", async () => {
    let clock = kst("2026-10-07T12:00:00"); // Wednesday
    const app = makeApp({ now: () => clock });
    const { admin, member, study } = await studySetup(app);
    const at = {
      prevSunday: kst("2026-10-04T23:59:00"),
      monday: kst("2026-10-05T00:00:00"),
      sunday: kst("2026-10-11T23:59:00"),
      nextMonday: kst("2026-10-12T00:00:00"),
    };
    const rPrev = await createRound(app, member, study.id, { title: "지난주", meetingAt: at.prevSunday });
    const rSun = await createRound(app, member, study.id, { title: "일요일", meetingAt: at.sunday, location: "온라인", scope: "x".repeat(500) });
    const rMon = await createRound(app, member, study.id, { title: "월요일", meetingAt: at.monday });
    const rNext = await createRound(app, member, study.id, { title: "다음주", meetingAt: at.nextMonday });
    await createRound(app, member, study.id, { title: "일정 없음" });
    await createPost(app, member, { roundId: rSun.id });
    const hiddenPost = await createPost(app, member, { roundId: rSun.id });
    await call(app, "POST", `/api/posts/${hiddenPost.id}/hide`, { cookie: admin.cookie });

    const res = await call(app, "GET", "/api/home", { cookie: member.cookie });
    expect(res.status).toBe(200);
    expect(res.json.nextMeetings).toEqual([
      {
        roundId: rMon.id,
        studyId: study.id,
        studyName: study.name,
        seq: 3,
        title: "월요일",
        scope: "1~3장",
        location: null,
        meetingAt: at.monday,
        roundStatus: "active",
        linkedPostCount: 0,
      },
      {
        roundId: rSun.id,
        studyId: study.id,
        studyName: study.name,
        seq: 2,
        title: "일요일",
        scope: "x".repeat(200),
        location: "온라인",
        meetingAt: at.sunday,
        roundStatus: "active",
        linkedPostCount: 1,
      },
    ]);
    expect(res.json.nextMeetings.map((m: { roundId: string }) => m.roundId)).not.toContain(rPrev.id);

    // At next Monday 00:00 KST the week rolls over. (Pretend Discord was just
    // checked so the jump in time does not trigger the 24h re-verification.)
    clock = at.nextMonday;
    await setVerifiedAt(member.memberId, clock);
    const next = await call(app, "GET", "/api/home", { cookie: member.cookie });
    expect(next.json.nextMeetings.map((m: { roundId: string }) => m.roundId)).toEqual([rNext.id]);
    // One millisecond earlier it is still Sunday.
    clock = at.nextMonday - 1;
    const sunday = await call(app, "GET", "/api/home", { cookie: member.cookie });
    expect(sunday.json.nextMeetings.map((m: { roundId: string }) => m.roundId)).toEqual([rMon.id, rSun.id]);
  });

  it("only my active, visible studies; non-members and admins outside the study see none", async () => {
    const clock = kst("2026-10-07T12:00:00");
    const app = makeApp({ now: () => clock });
    const { admin, member, outsider, study } = await studySetup(app);
    await createRound(app, member, study.id, { meetingAt: kst("2026-10-08T20:00:00") });
    expect((await call(app, "GET", "/api/home", { cookie: member.cookie })).json.nextMeetings).toHaveLength(1);
    expect((await call(app, "GET", "/api/home", { cookie: outsider.cookie })).json.nextMeetings).toEqual([]);
    expect((await call(app, "GET", "/api/home", { cookie: admin.cookie })).json.nextMeetings).toEqual([]);

    await call(app, "POST", `/api/studies/${study.id}/hide`, { cookie: admin.cookie });
    expect((await call(app, "GET", "/api/home", { cookie: member.cookie })).json.nextMeetings).toEqual([]);
    await call(app, "POST", `/api/studies/${study.id}/unhide`, { cookie: admin.cookie });
    await call(app, "POST", `/api/studies/${study.id}/end`, { cookie: admin.cookie });
    expect((await call(app, "GET", "/api/home", { cookie: member.cookie })).json.nextMeetings).toEqual([]);
    const fresh = await login(app);
    expect((await call(app, "GET", "/api/home", { cookie: fresh.cookie })).json).toEqual({
      nextMeetings: [],
      recentPosts: expect.any(Array),
    });
  });
});
