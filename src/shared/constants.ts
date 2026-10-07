export const LIMITS = {
  postTitleMax: 200,
  postBodyMax: 50_000,
  commentBodyMax: 5_000,
  linksMax: 10,
  linkUrlMax: 2_000,
  linkLabelMax: 200,
  tagsMax: 10,
  tagNameMax: 30,
  categoryNameMax: 30,
  searchMin: 2,
  searchMax: 50,
  pageSize: 20,
  // Studies (F-05)
  studyNameMax: 50,
  studyGoalMax: 500,
  studyCadenceMax: 100,
  /** Markdown fields: description, materials, join guide, round scope/materials, notes. */
  markdownMax: 20_000,
  // Rounds (F-06, F-09)
  roundTitleMax: 100,
  roundGoalMax: 1_000,
  roundLocationMax: 500,
  /** Linked posts shown on a round page. */
  roundPostsMax: 200,
  /** Characters of a round's scope in the home "this week" list. */
  scopeExcerpt: 200,
} as const;

/** POST /api/me/refresh-roles: at most once per this many seconds per member (TD-23). */
export const REFRESH_ROLES_INTERVAL_SECONDS = 60;

/** localStorage key prefix for drafts (TSD 8.1). Cleared on logout. */
export const draftKeyPrefix = (memberId: string) => `jungle5:draft:${memberId}:`;
