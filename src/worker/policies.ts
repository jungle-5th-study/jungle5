// Permission rules — 1:1 with PRD 5.4 and TSD 6.4. Pure functions only:
// routes load the facts, these functions decide. Never inline a permission
// check in a route.

export interface Actor {
  id: string;
  isAdmin: boolean;
  /** Last known Discord guild membership. */
  isGuildMember: boolean;
  withdrawn: boolean;
}

/** `null` = not logged in. */
export type MaybeActor = Actor | null | undefined;

/** There is no study manager (D-24); membership comes from a Discord role (D-23). */
export interface StudyFacts {
  status: "active" | "ended";
  /** Member IDs of the study (study_members, recomputed from Discord roles). */
  memberIds: readonly string[];
}

export interface RoundFacts {
  status: "active" | "ended";
}

export interface HideableStudy {
  hiddenAt: number | null;
}

export interface OwnedContent {
  authorId: string;
}

export interface HideableContent extends OwnedContent {
  hiddenAt: number | null;
}

/** Logged in, still in the Discord guild, not withdrawn. */
export function isCommunityMember(actor: MaybeActor): actor is Actor {
  return !!actor && actor.isGuildMember && !actor.withdrawn;
}

export function isAdmin(actor: MaybeActor): actor is Actor {
  return isCommunityMember(actor) && actor.isAdmin;
}

export function isStudyMember(actor: MaybeActor, study: StudyFacts): actor is Actor {
  return isCommunityMember(actor) && study.memberIds.includes(actor.id);
}

const isAuthor = (actor: MaybeActor, content: OwnedContent): actor is Actor =>
  isCommunityMember(actor) && content.authorId === actor.id;

// ---- 지식·스터디 읽기 / 작성 (all community members) ----
export const canRead = (actor: MaybeActor) => isCommunityMember(actor);
export const canCreatePost = (actor: MaybeActor) => isCommunityMember(actor);
export const canCreateComment = (actor: MaybeActor) => isCommunityMember(actor);
export const canCreateCategory = (actor: MaybeActor) => isCommunityMember(actor);
export const canWithdraw = (actor: MaybeActor) => isCommunityMember(actor);

/** Hidden content: only admins and the author see it (TD-17). */
export function canViewContent(actor: MaybeActor, content: HideableContent): boolean {
  if (!isCommunityMember(actor)) return false;
  if (content.hiddenAt === null) return true;
  return actor.isAdmin || content.authorId === actor.id;
}

// ---- 본인 것만 수정·삭제 (D-19). Authors may edit/delete even when hidden (TD-17). ----
export const canEditPost = (actor: MaybeActor, post: OwnedContent) => isAuthor(actor, post);
export const canDeletePost = (actor: MaybeActor, post: OwnedContent) => isAuthor(actor, post);
export const canEditComment = (actor: MaybeActor, comment: OwnedContent) => isAuthor(actor, comment);
export const canDeleteComment = (actor: MaybeActor, comment: OwnedContent) => isAuthor(actor, comment);

// ---- 운영자 ----
export const canHide = (actor: MaybeActor) => isAdmin(actor);
export const canManageCategory = (actor: MaybeActor) => isAdmin(actor);
/** Create a study and link its Discord role (D-23, D-24). */
export const canCreateStudy = (actor: MaybeActor) => isAdmin(actor);
/** End/reopen a study (D-24). Any study status. */
export const canEndStudy = (actor: MaybeActor) => isAdmin(actor);
/** Link a different Discord role to a study, which recomputes its members (D-23, D-24). */
export const canChangeStudyRole = (actor: MaybeActor) => isAdmin(actor);

/**
 * Hidden studies (and their rounds) are visible to admins only: there is no
 * study author to make an exception for (TD-17 analogue). Others get 404.
 */
export function canViewStudy(actor: MaybeActor, study: HideableStudy): boolean {
  if (!isCommunityMember(actor)) return false;
  return study.hiddenAt === null || actor.isAdmin;
}

// ---- 스터디 정보(목표·설명·공통 자료·참여 안내) 편집: study member or admin (D-24) ----
export function canEditStudy(actor: MaybeActor, study: StudyFacts): boolean {
  return isStudyMember(actor, study) || isAdmin(actor);
}

// ---- 회차 생성·편집, 모임 기록: study member or admin, and the study is active ----
const canWorkInStudy = (actor: MaybeActor, study: StudyFacts) =>
  (isStudyMember(actor, study) || isAdmin(actor)) && study.status === "active";

export function canCreateRound(actor: MaybeActor, study: StudyFacts): boolean {
  return canWorkInStudy(actor, study);
}

/** Round info edit. Ended rounds are read-only until reopened (F-06). */
export function canEditRound(actor: MaybeActor, study: StudyFacts, round: RoundFacts): boolean {
  return canWorkInStudy(actor, study) && round.status === "active";
}

/** Shared meeting notes (F-09). Same rule as round info. */
export function canWriteNotes(actor: MaybeActor, study: StudyFacts, round: RoundFacts): boolean {
  return canWorkInStudy(actor, study) && round.status === "active";
}

/** End/reopen a round: study members (F-06 "스터디 멤버는 종료를 취소해 재개"). */
export function canSetRoundStatus(actor: MaybeActor, study: StudyFacts): boolean {
  return canWorkInStudy(actor, study);
}

/**
 * Delete a round: study member or admin while the study is active (an ended
 * study's rounds are preserved, F-05). The round's status does not matter.
 * The route additionally requires the round to be empty (409 ROUND_NOT_EMPTY).
 */
export function canDeleteRound(actor: MaybeActor, study: StudyFacts): boolean {
  return canWorkInStudy(actor, study);
}

/** Round comments (personal retrospectives) stay open on ended rounds (F-06). */
export const canCommentOnRound = (actor: MaybeActor) => isCommunityMember(actor);

/**
 * D-15: the post's author, who is a member of the round's study. Admins get no
 * exception. Only active rounds of active studies accept new links (F-05, F-06).
 */
export function canLinkPostToRound(
  actor: MaybeActor,
  post: OwnedContent,
  study: StudyFacts,
  round: RoundFacts,
): boolean {
  return isAuthor(actor, post) && isStudyMember(actor, study) && study.status === "active" && round.status === "active";
}

/** Unlinking only needs authorship: losing the study role keeps old links (F-08). */
export const canUnlinkPostFromRound = (actor: MaybeActor, post: OwnedContent) => isAuthor(actor, post);
