// Post ↔ round linking (PRD F-08, D-15; TSD 7.1).
import { describe, expect, it } from "vitest";
import { call, createPost, createRound, login, makeApp, postInput, studySetup } from "../helpers";

const app = makeApp();

describe("linking at creation (POST /api/posts with roundId)", () => {
  it("a study member links their new post; the post shows the round summary", async () => {
    const { member, study } = await studySetup(app);
    const round = await createRound(app, member, study.id, { title: "3장" });
    const res = await call(app, "POST", "/api/posts", { cookie: member.cookie, body: postInput({ roundId: round.id }) });
    expect(res.status).toBe(201);
    const summary = { id: round.id, seq: 1, title: "3장", studyId: study.id, studyName: study.name };
    expect(res.json).toMatchObject({ roundId: round.id, round: summary });
    const list = await call(app, "GET", `/api/posts?round=${round.id}`, { cookie: member.cookie });
    expect(list.json.items).toEqual([expect.objectContaining({ id: res.json.id, roundId: round.id, round: summary })]);
  });

  it("non-members (admins included) → 403; ended round → 409 ROUND_ENDED; ended study → 409 STUDY_ENDED; nothing is created", async () => {
    const { admin, member, outsider, study } = await studySetup(app);
    const round = await createRound(app, member, study.id);
    for (const u of [outsider, admin]) {
      const input = postInput({ roundId: round.id });
      const res = await call(app, "POST", "/api/posts", { cookie: u.cookie, body: input });
      expect(res.status).toBe(403);
      expect((await call(app, "GET", `/api/posts/${input.id}`, { cookie: u.cookie })).status).toBe(404);
    }
    await call(app, "POST", `/api/rounds/${round.id}/end`, { cookie: member.cookie });
    const ended = await call(app, "POST", "/api/posts", { cookie: member.cookie, body: postInput({ roundId: round.id }) });
    expect(ended.status).toBe(409);
    expect(ended.json.error.code).toBe("ROUND_ENDED");

    await call(app, "POST", `/api/rounds/${round.id}/reopen`, { cookie: member.cookie });
    await call(app, "POST", `/api/studies/${study.id}/end`, { cookie: admin.cookie });
    const studyEnded = await call(app, "POST", "/api/posts", { cookie: member.cookie, body: postInput({ roundId: round.id }) });
    expect(studyEnded.status).toBe(409);
    expect(studyEnded.json.error.code).toBe("STUDY_ENDED");
  });
});

describe("PUT /api/posts/:id/round", () => {
  it("the author (a study member) links and unlinks; unlinking keeps the post", async () => {
    const { member, study } = await studySetup(app);
    const round = await createRound(app, member, study.id);
    const post = await createPost(app, member);
    const linked = await call(app, "PUT", `/api/posts/${post.id}/round`, { cookie: member.cookie, body: { roundId: round.id } });
    expect(linked.status).toBe(200);
    expect(linked.json).toMatchObject({ id: post.id, roundId: round.id, round: { id: round.id, seq: 1 } });
    expect(linked.json.updatedAt).toBe(post.updatedAt); // not a content edit

    const unlinked = await call(app, "PUT", `/api/posts/${post.id}/round`, { cookie: member.cookie, body: { roundId: null } });
    expect(unlinked.status).toBe(200);
    expect(unlinked.json).toMatchObject({ roundId: null, round: null, title: post.title });
    const detail = await call(app, "GET", `/api/rounds/${round.id}`, { cookie: member.cookie });
    expect(detail.json.posts).toEqual([]);
  });

  it("non-author → 403 (admins too); author not in the study → 403", async () => {
    const { admin, member, outsider, study } = await studySetup(app);
    const round = await createRound(app, member, study.id);
    const membersPost = await createPost(app, member);
    for (const u of [outsider, admin]) {
      const res = await call(app, "PUT", `/api/posts/${membersPost.id}/round`, { cookie: u.cookie, body: { roundId: round.id } });
      expect(res.status).toBe(403);
      const unlink = await call(app, "PUT", `/api/posts/${membersPost.id}/round`, { cookie: u.cookie, body: { roundId: null } });
      expect(unlink.status).toBe(403);
    }
    const outsidersPost = await createPost(app, outsider);
    const res = await call(app, "PUT", `/api/posts/${outsidersPost.id}/round`, { cookie: outsider.cookie, body: { roundId: round.id } });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe("FORBIDDEN");
  });

  it("an ended round rejects new links (409 ROUND_ENDED) but unlinking is always allowed", async () => {
    const { member, study } = await studySetup(app);
    const round = await createRound(app, member, study.id);
    const linkedPost = await createPost(app, member, { roundId: round.id });
    const freePost = await createPost(app, member);
    await call(app, "POST", `/api/rounds/${round.id}/end`, { cookie: member.cookie });
    const link = await call(app, "PUT", `/api/posts/${freePost.id}/round`, { cookie: member.cookie, body: { roundId: round.id } });
    expect(link.status).toBe(409);
    expect(link.json.error.code).toBe("ROUND_ENDED");
    const unlink = await call(app, "PUT", `/api/posts/${linkedPost.id}/round`, { cookie: member.cookie, body: { roundId: null } });
    expect(unlink.status).toBe(200);
  });

  it("losing the study role keeps existing links; the author can still unlink but not link again (F-08)", async () => {
    const { member, study } = await studySetup(app);
    const round = await createRound(app, member, study.id);
    const post = await createPost(app, member, { roundId: round.id });
    const relogged = await login(app, { discordUserId: member.discordUserId, roles: [] });
    expect(relogged.memberId).toBe(member.memberId);
    expect((await call(app, "GET", `/api/posts/${post.id}`, { cookie: relogged.cookie })).json.roundId).toBe(round.id);
    const unlink = await call(app, "PUT", `/api/posts/${post.id}/round`, { cookie: relogged.cookie, body: { roundId: null } });
    expect(unlink.status).toBe(200);
    const again = await call(app, "PUT", `/api/posts/${post.id}/round`, { cookie: relogged.cookie, body: { roundId: round.id } });
    expect(again.status).toBe(403);
  });

  it("unknown round → 422; unknown post → 404", async () => {
    const { member } = await studySetup(app);
    const post = await createPost(app, member);
    const res = await call(app, "PUT", `/api/posts/${post.id}/round`, {
      cookie: member.cookie,
      body: { roundId: "01900000-0000-7000-8000-0000000000ff" },
    });
    expect(res.status).toBe(422);
    expect(res.json.error.fields.roundId).toBeDefined();
    const missing = await call(app, "PUT", "/api/posts/01900000-0000-7000-8000-0000000000fe/round", {
      cookie: member.cookie,
      body: { roundId: null },
    });
    expect(missing.status).toBe(404);
  });

  it("a hidden study's round summary is not shown to non-admins on the post", async () => {
    const { admin, member, outsider, study } = await studySetup(app);
    const round = await createRound(app, member, study.id);
    const post = await createPost(app, member, { roundId: round.id });
    await call(app, "POST", `/api/studies/${study.id}/hide`, { cookie: admin.cookie });
    const asOutsider = await call(app, "GET", `/api/posts/${post.id}`, { cookie: outsider.cookie });
    expect(asOutsider.json.round).toBeNull();
    const asAdmin = await call(app, "GET", `/api/posts/${post.id}`, { cookie: admin.cookie });
    expect(asAdmin.json.round).toMatchObject({ id: round.id });
  });
});

describe("GET /api/me/linkable-rounds", () => {
  it("active rounds of my active studies, newest first", async () => {
    let tick = Date.now();
    const a = makeApp({ now: () => ++tick });
    const s1 = await studySetup(a);
    const r1 = await createRound(a, s1.member, s1.study.id, { title: "s1-1" });
    const r2 = await createRound(a, s1.member, s1.study.id, { title: "s1-2" });
    const ended = await createRound(a, s1.member, s1.study.id, { title: "끝난 회차" });
    await call(a, "POST", `/api/rounds/${ended.id}/end`, { cookie: s1.member.cookie });
    // A study I am not in, and an ended study of mine.
    const s2 = await studySetup(a);
    await createRound(a, s2.member, s2.study.id);

    const res = await call(a, "GET", "/api/me/linkable-rounds", { cookie: s1.member.cookie });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      items: [
        { id: r2.id, seq: 2, title: "s1-2", studyId: s1.study.id, studyName: s1.study.name },
        { id: r1.id, seq: 1, title: "s1-1", studyId: s1.study.id, studyName: s1.study.name },
      ],
    });
    await call(a, "POST", `/api/studies/${s1.study.id}/end`, { cookie: s1.admin.cookie });
    expect((await call(a, "GET", "/api/me/linkable-rounds", { cookie: s1.member.cookie })).json.items).toEqual([]);
    // Admins who are not members have nothing to link (D-15).
    expect((await call(a, "GET", "/api/me/linkable-rounds", { cookie: s2.admin.cookie })).json.items).toEqual([]);
  });
});
