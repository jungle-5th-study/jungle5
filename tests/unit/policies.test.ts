// Table-driven tests of every policy function × role (TSD 10, PRD 5.4).
import { describe, expect, it } from "vitest";
import * as P from "../../src/worker/policies";
import type { Actor, MaybeActor, RoundFacts, StudyFacts } from "../../src/worker/policies";

type Role =
  | "anonymous"
  | "nonMember"
  | "communityMember"
  | "studyMember"
  | "admin"
  | "withdrawn";

const ROLES: Role[] = [
  "anonymous",
  "nonMember",
  "communityMember",
  "studyMember",
  "admin",
  "withdrawn",
];

const base: Actor = { id: "", isAdmin: false, isGuildMember: true, withdrawn: false };
const actors: Record<Role, MaybeActor> = {
  anonymous: null,
  nonMember: { ...base, id: "u-nonmember", isGuildMember: false },
  communityMember: { ...base, id: "u-community" },
  studyMember: { ...base, id: "u-studymember" },
  admin: { ...base, id: "u-admin", isAdmin: true },
  withdrawn: { ...base, id: "u-withdrawn", withdrawn: true },
};

// The study's member list deliberately includes the withdrawn and non-member
// actors so the tests prove those flags win over membership.
const activeStudy: StudyFacts = {
  status: "active",
  memberIds: ["u-studymember", "u-withdrawn", "u-nonmember"],
};
const endedStudy: StudyFacts = { ...activeStudy, status: "ended" };
const activeRound: RoundFacts = { status: "active" };
const endedRound: RoundFacts = { status: "ended" };

/** Roles expected to be allowed; every other role must be denied. */
function table(name: string, check: (a: MaybeActor) => boolean, allowed: Role[]) {
  describe(name, () => {
    it.each(ROLES)("%s", (role) => {
      expect(check(actors[role])).toBe(allowed.includes(role));
    });
  });
}

const MEMBERS: Role[] = ["communityMember", "studyMember", "admin"];

describe("policies (PRD 5.4)", () => {
  // 지식·스터디 읽기, 글·댓글 작성, 카테고리 추가: all community members
  table("canRead", P.canRead, MEMBERS);
  table("canCreatePost", P.canCreatePost, MEMBERS);
  table("canCreateComment", P.canCreateComment, MEMBERS);
  table("canCreateCategory", P.canCreateCategory, MEMBERS);
  table("canWithdraw", P.canWithdraw, MEMBERS);
  table("canCommentOnRound", P.canCommentOnRound, MEMBERS);

  // 본인 것만 수정·삭제: the author is the community member here.
  const ownPost = { authorId: "u-community" };
  table("canEditPost (author = communityMember)", (a) => P.canEditPost(a, ownPost), ["communityMember"]);
  table("canDeletePost (author = communityMember)", (a) => P.canDeletePost(a, ownPost), ["communityMember"]);
  table("canEditComment (author = communityMember)", (a) => P.canEditComment(a, ownPost), ["communityMember"]);
  table("canDeleteComment (author = communityMember)", (a) => P.canDeleteComment(a, ownPost), ["communityMember"]);
  table("canUnlinkPostFromRound (author = communityMember)", (a) => P.canUnlinkPostFromRound(a, ownPost), [
    "communityMember",
  ]);
  table("canEditPost: a withdrawn author cannot edit", (a) => P.canEditPost(a, { authorId: "u-withdrawn" }), []);

  // TD-17 hidden content
  const visible = { authorId: "u-community", hiddenAt: null };
  const hidden = { authorId: "u-community", hiddenAt: 1 };
  table("canViewContent (visible)", (a) => P.canViewContent(a, visible), MEMBERS);
  table("canViewContent (hidden: admin + author only)", (a) => P.canViewContent(a, hidden), [
    "communityMember",
    "admin",
  ]);

  // 첨부 HTML (D-30 ~ D-32)
  table("canEditPostHtml (author = communityMember)", (a) => P.canEditPostHtml(a, ownPost), ["communityMember"]);
  table("canViewPostHtml (visible)", (a) => P.canViewPostHtml(a, visible), MEMBERS);
  table("canViewPostHtml (hidden: admin + author only)", (a) => P.canViewPostHtml(a, hidden), ["communityMember", "admin"]);
  table("canManageDiscordCommands", P.canManageDiscordCommands, ["admin"]);
  table("discordUploadDenial (own message)", (a) => P.discordUploadDenial(a, "d1", "d1") === null, MEMBERS);
  table("discordUploadDenial (someone else's message)", (a) => P.discordUploadDenial(a, "d1", "d2") === null, []);
  it("discordUploadDenial reasons", () => {
    expect(P.discordUploadDenial(actors.communityMember, "d1", "d2")).toBe("not_author");
    expect(P.discordUploadDenial(actors.anonymous, "d1", "d2")).toBe("not_author");
    expect(P.discordUploadDenial(actors.anonymous, "d1", "d1")).toBe("not_member");
    expect(P.discordUploadDenial(actors.withdrawn, "d1", "d1")).toBe("not_member");
    expect(P.discordUploadDenial(actors.nonMember, "d1", "d1")).toBe("not_member");
    expect(P.discordUploadDenial(actors.communityMember, "", "")).toBe("not_author");
  });

  // 운영자 전용
  table("canHide", P.canHide, ["admin"]);
  table("canManageCategory", P.canManageCategory, ["admin"]);
  // 스터디 만들기·Discord 역할 연결·종료·재개: admin only (D-24)
  table("canCreateStudy", P.canCreateStudy, ["admin"]);
  table("canEndStudy", P.canEndStudy, ["admin"]);

  // 스터디 정보 편집: study member or admin, any study status (D-24)
  table("canEditStudy (active)", (a) => P.canEditStudy(a, activeStudy), ["studyMember", "admin"]);
  table("canEditStudy (ended)", (a) => P.canEditStudy(a, endedStudy), ["studyMember", "admin"]);

  // 회차 생성·편집, 모임 기록: study members or admin, while the study is active
  const STUDY_WORKERS: Role[] = ["studyMember", "admin"];
  table("canCreateRound (active study)", (a) => P.canCreateRound(a, activeStudy), STUDY_WORKERS);
  table("canCreateRound (ended study)", (a) => P.canCreateRound(a, endedStudy), []);
  table("canEditRound (active study, active round)", (a) => P.canEditRound(a, activeStudy, activeRound), STUDY_WORKERS);
  table("canEditRound (ended round)", (a) => P.canEditRound(a, activeStudy, endedRound), []);
  table("canEditRound (ended study)", (a) => P.canEditRound(a, endedStudy, activeRound), []);
  table("canWriteNotes (active)", (a) => P.canWriteNotes(a, activeStudy, activeRound), STUDY_WORKERS);
  table("canWriteNotes (ended round)", (a) => P.canWriteNotes(a, activeStudy, endedRound), []);
  table("canWriteNotes (ended study)", (a) => P.canWriteNotes(a, endedStudy, activeRound), []);
  table("canSetRoundStatus (active study)", (a) => P.canSetRoundStatus(a, activeStudy), STUDY_WORKERS);
  table("canSetRoundStatus (ended study)", (a) => P.canSetRoundStatus(a, endedStudy), []);

  table("canDeleteRound (active study)", (a) => P.canDeleteRound(a, activeStudy), STUDY_WORKERS);
  table("canDeleteRound (ended study)", (a) => P.canDeleteRound(a, endedStudy), []);

  // 스터디 역할 연결 변경: admin only (D-23, D-24)
  table("canChangeStudyRole", P.canChangeStudyRole, ["admin"]);

  // Hidden studies: admin only; visible studies: every community member
  table("canViewStudy (visible)", (a) => P.canViewStudy(a, { hiddenAt: null }), MEMBERS);
  table("canViewStudy (hidden: admin only)", (a) => P.canViewStudy(a, { hiddenAt: 1 }), ["admin"]);

  // D-15 회차 연결: the post author AND a study member, active study + active round
  table(
    "canLinkPostToRound (author = studyMember)",
    (a) => P.canLinkPostToRound(a, { authorId: "u-studymember" }, activeStudy, activeRound),
    ["studyMember"],
  );
  table(
    "canLinkPostToRound (author = studyMember, ended round)",
    (a) => P.canLinkPostToRound(a, { authorId: "u-studymember" }, activeStudy, endedRound),
    [],
  );
  table(
    "canLinkPostToRound (author = studyMember, ended study)",
    (a) => P.canLinkPostToRound(a, { authorId: "u-studymember" }, endedStudy, activeRound),
    [],
  );
  table(
    "canLinkPostToRound (author = communityMember, not in study)",
    (a) => P.canLinkPostToRound(a, { authorId: "u-community" }, activeStudy, activeRound),
    [],
  );
  table(
    "canLinkPostToRound (author = admin, not in study)",
    (a) => P.canLinkPostToRound(a, { authorId: "u-admin" }, activeStudy, activeRound),
    [],
  );
  table(
    "canLinkPostToRound (author = admin, in study)",
    (a) => P.canLinkPostToRound(a, { authorId: "u-admin" }, { ...activeStudy, memberIds: ["u-admin"] }, activeRound),
    ["admin"],
  );
  table(
    "canLinkPostToRound (author = withdrawn, listed in study)",
    (a) => P.canLinkPostToRound(a, { authorId: "u-withdrawn" }, activeStudy, activeRound),
    [],
  );
  // Unlinking needs authorship only, so a former study member (or an ended round) never traps a link.
  table(
    "canUnlinkPostFromRound (author = studyMember)",
    (a) => P.canUnlinkPostFromRound(a, { authorId: "u-studymember" }),
    ["studyMember"],
  );
});
