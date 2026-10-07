// Rounds (PRD F-06, F-09; TSD 7.1, 8.2, TD-13, TD-14).
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { call, createPost, createRound, makeApp, roundInput, studySetup, uuidv7 } from "../helpers";

// A strictly increasing clock so "newest first" never depends on same-millisecond ties.
let tick = Date.now();
const app = makeApp({ now: () => ++tick });

describe("POST /api/studies/:id/rounds", () => {
  it("study members and admins create rounds; seq increments per study", async () => {
    const { admin, member, study } = await studySetup(app);
    const input = roundInput({
      title: "1회차",
      periodStart: "2026-10-05",
      periodEnd: "2026-10-11",
      meetingAt: 1_791_500_000_000,
      location: "https://meet.example/x",
      materials: "- 링크",
    });
    const res = await call(app, "POST", `/api/studies/${study.id}/rounds`, { cookie: member.cookie, body: input });
    expect(res.status).toBe(201);
    expect(res.json).toEqual({
      id: input.id,
      studyId: study.id,
      seq: 1,
      title: "1회차",
      scope: "1~3장",
      goal: "개념 이해",
      periodStart: "2026-10-05",
      periodEnd: "2026-10-11",
      meetingAt: 1_791_500_000_000,
      location: "https://meet.example/x",
      materials: "- 링크",
      status: "active",
      infoVersion: 1,
      infoUpdatedBy: null,
      infoUpdatedAt: null,
      notesDiscussion: null,
      notesOpenQuestions: null,
      notesNextActions: null,
      notesVersion: 1,
      notesUpdatedBy: null,
      notesUpdatedAt: null,
      createdBy: { id: member.memberId, displayName: expect.any(String), avatarUrl: expect.any(String), withdrawn: false },
      createdAt: expect.any(Number),
    });
    const second = await createRound(app, admin, study.id);
    expect(second.seq).toBe(2);
    // Another study starts at 1.
    const other = await studySetup(app);
    expect((await createRound(app, other.member, other.study.id)).seq).toBe(1);
  });

  it("same id again → 200 with the existing round (TD-13); someone else's id → 409 DUPLICATE", async () => {
    const { admin, member, study } = await studySetup(app);
    const input = roundInput();
    const first = await call(app, "POST", `/api/studies/${study.id}/rounds`, { cookie: member.cookie, body: input });
    expect(first.status).toBe(201);
    const replay = await call(app, "POST", `/api/studies/${study.id}/rounds`, { cookie: member.cookie, body: input });
    expect(replay.status).toBe(200);
    expect(replay.json).toEqual(first.json);
    const stolen = await call(app, "POST", `/api/studies/${study.id}/rounds`, { cookie: admin.cookie, body: input });
    expect(stolen.status).toBe(409);
    expect(stolen.json.error.code).toBe("DUPLICATE");
    const count = await env.DB.prepare("SELECT count(*) AS n FROM rounds WHERE study_id = ?").bind(study.id).first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("concurrent creates get distinct, consecutive seq numbers", async () => {
    const { admin, member, study } = await studySetup(app);
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        call(app, "POST", `/api/studies/${study.id}/rounds`, { cookie: i % 2 ? admin.cookie : member.cookie, body: roundInput() }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(results.map((r) => r.json.seq as number).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("concurrent replays of the same id create one round", async () => {
    const { member, study } = await studySetup(app);
    const input = roundInput();
    const results = await Promise.all(
      [1, 2, 3].map(() => call(app, "POST", `/api/studies/${study.id}/rounds`, { cookie: member.cookie, body: input })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    const count = await env.DB.prepare("SELECT count(*) AS n FROM rounds WHERE study_id = ?").bind(study.id).first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("non-members → 403; hidden/unknown study → 404; validation → 422", async () => {
    const { member, outsider, study } = await studySetup(app);
    const denied = await call(app, "POST", `/api/studies/${study.id}/rounds`, { cookie: outsider.cookie, body: roundInput() });
    expect(denied.status).toBe(403);
    expect((await call(app, "POST", `/api/studies/${uuidv7()}/rounds`, { cookie: member.cookie, body: roundInput() })).status).toBe(404);
    const bad: [Record<string, unknown>, string][] = [
      [{ title: "" }, "title"],
      [{ scope: undefined }, "scope"],
      [{ goal: " " }, "goal"],
      [{ periodStart: "2026-13-01" }, "periodStart"],
      [{ periodStart: "2026-02-30" }, "periodStart"],
      [{ periodStart: "2026-10-10", periodEnd: "2026-10-01" }, "periodEnd"],
      [{ meetingAt: "tomorrow" }, "meetingAt"],
      [{ meetingAt: 1.5 }, "meetingAt"],
    ];
    for (const [override, field] of bad) {
      const res = await call(app, "POST", `/api/studies/${study.id}/rounds`, { cookie: member.cookie, body: roundInput(override) });
      expect(res.status, JSON.stringify(override)).toBe(422);
      expect(res.json.error.fields[field], JSON.stringify(res.json)).toBeDefined();
    }
  });
});

describe("PATCH /api/rounds/:id/info and /notes (TD-14, TSD 8.2)", () => {
  it("edits info and notes with separate versions and records who/when", async () => {
    const { admin, member, study } = await studySetup(app);
    const round = await createRound(app, member, study.id, { periodStart: "2026-10-01" });
    const info = await call(app, "PATCH", `/api/rounds/${round.id}/info`, {
      cookie: admin.cookie,
      body: { infoVersion: 1, title: "새 제목", location: "강남", periodStart: null },
    });
    expect(info.status).toBe(200);
    expect(info.json).toMatchObject({
      title: "새 제목",
      scope: "1~3장",
      location: "강남",
      periodStart: null,
      infoVersion: 2,
      notesVersion: 1,
      infoUpdatedBy: { id: admin.memberId },
      infoUpdatedAt: expect.any(Number),
    });
    // Notes keep their own version: editing them with notesVersion 1 still works.
    const notes = await call(app, "PATCH", `/api/rounds/${round.id}/notes`, {
      cookie: member.cookie,
      body: { notesVersion: 1, notesDiscussion: "논의", notesOpenQuestions: "질문?", notesNextActions: "다음" },
    });
    expect(notes.status).toBe(200);
    expect(notes.json).toMatchObject({
      title: "새 제목",
      notesDiscussion: "논의",
      notesOpenQuestions: "질문?",
      notesNextActions: "다음",
      notesVersion: 2,
      infoVersion: 2,
      notesUpdatedBy: { id: member.memberId },
      notesUpdatedAt: expect.any(Number),
    });
    // Omitted notes fields are unchanged; "" clears.
    const partial = await call(app, "PATCH", `/api/rounds/${round.id}/notes`, {
      cookie: member.cookie,
      body: { notesVersion: 2, notesNextActions: "" },
    });
    expect(partial.json).toMatchObject({ notesDiscussion: "논의", notesNextActions: null, notesVersion: 3 });
  });

  it("stale info version → 409 with the latest round; nothing overwritten", async () => {
    const { admin, member, study } = await studySetup(app);
    const round = await createRound(app, member, study.id);
    expect(
      (await call(app, "PATCH", `/api/rounds/${round.id}/info`, { cookie: member.cookie, body: { infoVersion: 1, title: "A" } })).status,
    ).toBe(200);
    const stale = await call(app, "PATCH", `/api/rounds/${round.id}/info`, {
      cookie: admin.cookie,
      body: { infoVersion: 1, title: "B", goal: "덮어쓰기" },
    });
    expect(stale.status).toBe(409);
    expect(stale.json.error).toMatchObject({
      code: "VERSION_CONFLICT",
      latest: { id: round.id, title: "A", goal: "개념 이해", infoVersion: 2, infoUpdatedBy: { id: member.memberId } },
    });
    const row = await env.DB.prepare("SELECT title, goal, info_version FROM rounds WHERE id = ?").bind(round.id).first();
    expect(row).toEqual({ title: "A", goal: "개념 이해", info_version: 2 });
  });

  it("stale notes version → 409 with the latest notes; my input is not saved", async () => {
    const { admin, member, study } = await studySetup(app);
    const round = await createRound(app, member, study.id);
    await call(app, "PATCH", `/api/rounds/${round.id}/notes`, {
      cookie: admin.cookie,
      body: { notesVersion: 1, notesDiscussion: "먼저" },
    });
    const stale = await call(app, "PATCH", `/api/rounds/${round.id}/notes`, {
      cookie: member.cookie,
      body: { notesVersion: 1, notesDiscussion: "나중", notesOpenQuestions: "q" },
    });
    expect(stale.status).toBe(409);
    expect(stale.json.error).toMatchObject({
      code: "VERSION_CONFLICT",
      latest: { notesDiscussion: "먼저", notesOpenQuestions: null, notesVersion: 2 },
    });
    const row = await env.DB.prepare("SELECT notes_discussion, notes_open_questions FROM rounds WHERE id = ?").bind(round.id).first();
    expect(row).toEqual({ notes_discussion: "먼저", notes_open_questions: null });
  });

  it("non-members → 403; version and period rules → 422", async () => {
    const { member, outsider, study } = await studySetup(app);
    const round = await createRound(app, member, study.id, { periodStart: "2026-10-10" });
    for (const path of ["info", "notes"]) {
      const body = path === "info" ? { infoVersion: 1, title: "x" } : { notesVersion: 1, notesDiscussion: "x" };
      expect((await call(app, "PATCH", `/api/rounds/${round.id}/${path}`, { cookie: outsider.cookie, body })).status).toBe(403);
    }
    expect((await call(app, "PATCH", `/api/rounds/${round.id}/info`, { cookie: member.cookie, body: { title: "x" } })).status).toBe(422);
    const period = await call(app, "PATCH", `/api/rounds/${round.id}/info`, {
      cookie: member.cookie,
      body: { infoVersion: 1, periodEnd: "2026-10-01" },
    });
    expect(period.status).toBe(422);
    expect(period.json.error.fields.periodEnd).toBeDefined();
  });
});

describe("ended rounds and studies", () => {
  it("an ended round blocks info/notes edits (409 ROUND_ENDED) but allows comments; reopen restores", async () => {
    const { member, outsider, study } = await studySetup(app);
    const round = await createRound(app, member, study.id);
    expect((await call(app, "POST", `/api/rounds/${round.id}/end`, { cookie: outsider.cookie })).status).toBe(403);
    const ended = await call(app, "POST", `/api/rounds/${round.id}/end`, { cookie: member.cookie });
    expect(ended.status).toBe(200);
    expect(ended.json.status).toBe("ended");

    const info = await call(app, "PATCH", `/api/rounds/${round.id}/info`, { cookie: member.cookie, body: { infoVersion: 1, title: "x" } });
    expect(info.status).toBe(409);
    expect(info.json.error.code).toBe("ROUND_ENDED");
    const notes = await call(app, "PATCH", `/api/rounds/${round.id}/notes`, {
      cookie: member.cookie,
      body: { notesVersion: 1, notesDiscussion: "x" },
    });
    expect(notes.json.error.code).toBe("ROUND_ENDED");
    // Non-members still get 403, not a status hint.
    const outsiderInfo = await call(app, "PATCH", `/api/rounds/${round.id}/info`, { cookie: outsider.cookie, body: { infoVersion: 1, title: "x" } });
    expect(outsiderInfo.status).toBe(403);

    for (const u of [member, outsider]) {
      const comment = await call(app, "POST", `/api/rounds/${round.id}/comments`, {
        cookie: u.cookie,
        body: { id: uuidv7(), body: "회고" },
      });
      expect(comment.status).toBe(201);
    }

    const detail = await call(app, "GET", `/api/rounds/${round.id}`, { cookie: member.cookie });
    expect(detail.json.permissions).toEqual({
      canEditInfo: false,
      canWriteNotes: false,
      canSetStatus: true,
      canDelete: false,
      canLink: false,
      canComment: true,
    });

    expect((await call(app, "POST", `/api/rounds/${round.id}/reopen`, { cookie: member.cookie })).json.status).toBe("active");
    expect(
      (await call(app, "PATCH", `/api/rounds/${round.id}/info`, { cookie: member.cookie, body: { infoVersion: 1, title: "재개" } })).status,
    ).toBe(200);
  });

  it("an ended study blocks round edits, status changes and deletes with 409 STUDY_ENDED; comments still work", async () => {
    const { admin, member, study } = await studySetup(app);
    const round = await createRound(app, member, study.id);
    await call(app, "POST", `/api/studies/${study.id}/end`, { cookie: admin.cookie });
    const attempts = [
      call(app, "PATCH", `/api/rounds/${round.id}/info`, { cookie: member.cookie, body: { infoVersion: 1, title: "x" } }),
      call(app, "PATCH", `/api/rounds/${round.id}/notes`, { cookie: member.cookie, body: { notesVersion: 1, notesDiscussion: "x" } }),
      call(app, "POST", `/api/rounds/${round.id}/end`, { cookie: member.cookie }),
      call(app, "DELETE", `/api/rounds/${round.id}`, { cookie: admin.cookie }),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(409);
      expect(res.json.error.code).toBe("STUDY_ENDED");
    }
    const comment = await call(app, "POST", `/api/rounds/${round.id}/comments`, { cookie: member.cookie, body: { id: uuidv7(), body: "x" } });
    expect(comment.status).toBe(201);
  });
});

describe("DELETE /api/rounds/:id", () => {
  it("deletes an empty round (study member or admin); others 403", async () => {
    const { admin, member, outsider, study } = await studySetup(app);
    const a = await createRound(app, member, study.id);
    const b = await createRound(app, member, study.id);
    expect((await call(app, "DELETE", `/api/rounds/${a.id}`, { cookie: outsider.cookie })).status).toBe(403);
    const detail = await call(app, "GET", `/api/rounds/${a.id}`, { cookie: member.cookie });
    expect(detail.json.permissions.canDelete).toBe(true);
    expect((await call(app, "DELETE", `/api/rounds/${a.id}`, { cookie: member.cookie })).status).toBe(204);
    expect((await call(app, "DELETE", `/api/rounds/${b.id}`, { cookie: admin.cookie })).status).toBe(204);
    expect((await call(app, "GET", `/api/rounds/${a.id}`, { cookie: member.cookie })).status).toBe(404);
    expect((await call(app, "DELETE", `/api/rounds/${a.id}`, { cookie: member.cookie })).status).toBe(404);
  });

  it("409 ROUND_NOT_EMPTY with a linked post, a comment (even hidden) or notes", async () => {
    const { admin, member, study } = await studySetup(app);
    const withPost = await createRound(app, member, study.id);
    const post = await createPost(app, member, { roundId: withPost.id });
    // Hidden posts count too.
    await call(app, "POST", `/api/posts/${post.id}/hide`, { cookie: admin.cookie });

    const withComment = await createRound(app, member, study.id);
    const commentId = uuidv7();
    await call(app, "POST", `/api/rounds/${withComment.id}/comments`, { cookie: member.cookie, body: { id: commentId, body: "c" } });
    await call(app, "POST", `/api/comments/${commentId}/hide`, { cookie: admin.cookie });

    const withNotes = await createRound(app, member, study.id);
    await call(app, "PATCH", `/api/rounds/${withNotes.id}/notes`, {
      cookie: member.cookie,
      body: { notesVersion: 1, notesNextActions: "할 일" },
    });

    for (const r of [withPost, withComment, withNotes]) {
      const res = await call(app, "DELETE", `/api/rounds/${r.id}`, { cookie: member.cookie });
      expect(res.status).toBe(409);
      expect(res.json.error.code).toBe("ROUND_NOT_EMPTY");
      const d = await call(app, "GET", `/api/rounds/${r.id}`, { cookie: admin.cookie });
      expect(d.json.permissions.canDelete).toBe(false);
    }

    // Unlinking the post empties the round again.
    await call(app, "PUT", `/api/posts/${post.id}/round`, { cookie: member.cookie, body: { roundId: null } });
    expect((await call(app, "DELETE", `/api/rounds/${withPost.id}`, { cookie: member.cookie })).status).toBe(204);
  });
});

describe("GET /api/rounds/:id", () => {
  it("returns the round, study, linked posts (newest first, hidden excluded), comments, previous round and permissions", async () => {
    const { admin, member, outsider, study } = await studySetup(app);
    const r1 = await createRound(app, member, study.id, { title: "1회차" });
    await call(app, "PATCH", `/api/rounds/${r1.id}/notes`, {
      cookie: member.cookie,
      body: { notesVersion: 1, notesDiscussion: "논의", notesOpenQuestions: "남은 질문", notesNextActions: "다음 행동" },
    });
    const r2 = await createRound(app, member, study.id, { title: "2회차" });

    const older = await createPost(app, member, { title: "먼저", roundId: r2.id });
    const newer = await createPost(app, member, { title: "나중", roundId: r2.id });
    const hidden = await createPost(app, member, { title: "숨김", roundId: r2.id });
    await call(app, "POST", `/api/posts/${hidden.id}/hide`, { cookie: admin.cookie });
    await createPost(app, member, { title: "다른 회차", roundId: r1.id });
    const commentId = uuidv7();
    await call(app, "POST", `/api/rounds/${r2.id}/comments`, { cookie: outsider.cookie, body: { id: commentId, body: "배운 점" } });

    const res = await call(app, "GET", `/api/rounds/${r2.id}`, { cookie: outsider.cookie });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      id: r2.id,
      seq: 2,
      title: "2회차",
      study: { id: study.id, name: study.name, status: "active", hidden: false },
      isMember: false,
      previous: { id: r1.id, seq: 1, title: "1회차", notesOpenQuestions: "남은 질문", notesNextActions: "다음 행동" },
      permissions: {
        canEditInfo: false,
        canWriteNotes: false,
        canSetStatus: false,
        canDelete: false,
        canLink: false,
        canComment: true,
      },
    });
    expect(res.json.previous).not.toHaveProperty("notesDiscussion");
    expect(res.json.posts.map((p: { id: string }) => p.id)).toEqual([newer.id, older.id]);
    expect(res.json.posts[0].round).toEqual({ id: r2.id, seq: 2, title: "2회차", studyId: study.id, studyName: study.name });
    expect(res.json.comments).toEqual([
      expect.objectContaining({ id: commentId, roundId: r2.id, postId: null, body: "배운 점", author: expect.objectContaining({ id: outsider.memberId }) }),
    ]);

    // The author and admins still see the hidden post (TD-17).
    const asAuthor = await call(app, "GET", `/api/rounds/${r2.id}`, { cookie: member.cookie });
    expect(asAuthor.json.posts.map((p: { id: string }) => p.id)).toEqual([hidden.id, newer.id, older.id]);
    expect(asAuthor.json.isMember).toBe(true);
    expect(asAuthor.json.permissions).toEqual({
      canEditInfo: true,
      canWriteNotes: true,
      canSetStatus: true,
      canDelete: false,
      canLink: true,
      canComment: true,
    });
    // Admin (not a member): may edit, may not link (D-15).
    const asAdmin = await call(app, "GET", `/api/rounds/${r2.id}`, { cookie: admin.cookie });
    expect(asAdmin.json.permissions).toMatchObject({ canEditInfo: true, canLink: false });

    // The first round has no previous round.
    expect((await call(app, "GET", `/api/rounds/${r1.id}`, { cookie: member.cookie })).json.previous).toBeNull();
  });

  it("previous is the closest earlier round when seq - 1 was deleted", async () => {
    const { member, study } = await studySetup(app);
    const r1 = await createRound(app, member, study.id, { title: "1" });
    const r2 = await createRound(app, member, study.id, { title: "2" });
    const r3 = await createRound(app, member, study.id, { title: "3" });
    expect((await call(app, "GET", `/api/rounds/${r3.id}`, { cookie: member.cookie })).json.previous.id).toBe(r2.id);
    await call(app, "DELETE", `/api/rounds/${r2.id}`, { cookie: member.cookie });
    expect((await call(app, "GET", `/api/rounds/${r3.id}`, { cookie: member.cookie })).json.previous.id).toBe(r1.id);
  });
});

describe("round comments", () => {
  it("any member comments (idempotent); own edit/delete; admin hides", async () => {
    const { admin, member, outsider, study } = await studySetup(app);
    const round = await createRound(app, member, study.id);
    const input = { id: uuidv7(), body: "어려웠던 점" };
    const first = await call(app, "POST", `/api/rounds/${round.id}/comments`, { cookie: outsider.cookie, body: input });
    expect(first.status).toBe(201);
    expect(first.json).toMatchObject({ id: input.id, roundId: round.id, postId: null, body: "어려웠던 점" });
    const replay = await call(app, "POST", `/api/rounds/${round.id}/comments`, { cookie: outsider.cookie, body: input });
    expect(replay.status).toBe(200);
    expect(replay.json).toEqual(first.json);
    // Same id by someone else, or on another parent → 409.
    expect((await call(app, "POST", `/api/rounds/${round.id}/comments`, { cookie: member.cookie, body: input })).status).toBe(409);
    const post = await createPost(app, outsider);
    expect((await call(app, "POST", `/api/posts/${post.id}/comments`, { cookie: outsider.cookie, body: input })).status).toBe(409);

    expect((await call(app, "PATCH", `/api/comments/${input.id}`, { cookie: member.cookie, body: { body: "x" } })).status).toBe(403);
    const edited = await call(app, "PATCH", `/api/comments/${input.id}`, { cookie: outsider.cookie, body: { body: "수정" } });
    expect(edited.json.body).toBe("수정");

    expect((await call(app, "POST", `/api/comments/${input.id}/hide`, { cookie: member.cookie })).status).toBe(403);
    expect((await call(app, "POST", `/api/comments/${input.id}/hide`, { cookie: admin.cookie })).status).toBe(204);
    const asOther = await call(app, "GET", `/api/rounds/${round.id}`, { cookie: member.cookie });
    expect(asOther.json.comments).toEqual([]);
    const asAuthor = await call(app, "GET", `/api/rounds/${round.id}`, { cookie: outsider.cookie });
    expect(asAuthor.json.comments).toEqual([expect.objectContaining({ id: input.id, hidden: true })]);

    expect((await call(app, "DELETE", `/api/comments/${input.id}`, { cookie: outsider.cookie })).status).toBe(204);
    expect((await call(app, "POST", `/api/rounds/${uuidv7()}/comments`, { cookie: outsider.cookie, body: { id: uuidv7(), body: "x" } })).status).toBe(404);
    expect((await call(app, "POST", `/api/rounds/${round.id}/comments`, { cookie: outsider.cookie, body: { id: uuidv7(), body: "" } })).status).toBe(422);
  });
});
