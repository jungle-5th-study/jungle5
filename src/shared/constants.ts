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
  // Attached HTML file (D-30, TD-25)
  /**
   * Original (uncompressed) UTF-8 bytes of a site upload. The SPA checks it and
   * gzips the file; the server trusts the declared size (TD-25, TSD 3.2).
   */
  htmlMaxOriginalBytes: 50_000_000,
  /**
   * Bytes the server receives and stores: the gzip body of a site upload, or a
   * raw (identity) text/html body. One D1 value is capped at 2,000,000 bytes,
   * so files are stored in pieces (TD-25, migrations 0004/0005).
   */
  htmlMaxStoredBytes: 10_000_000,
  /** Discord message command (D-32): stored as-is, no server-side compression. 10 MB is Discord's free upload cap. */
  htmlDiscordMaxBytes: 10_000_000,
  htmlFilenameMax: 200,
} as const;

/** Accepted extensions of an attached HTML file (D-30), lower case. */
export const HTML_EXTENSIONS = [".html", ".htm"] as const;

/** Lifetime of a signed URL to the isolated HTML worker (TD-26). */
export const HTML_URL_TTL_SECONDS = 60 * 60;

/** POST /api/me/refresh-roles: at most once per this many seconds per member (TD-23). */
export const REFRESH_ROLES_INTERVAL_SECONDS = 60;

/** localStorage key prefix for drafts (TSD 8.1). Cleared on logout. */
export const draftKeyPrefix = (memberId: string) => `jungle5:draft:${memberId}:`;
