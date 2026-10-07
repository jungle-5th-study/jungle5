// Drizzle schema for every table in TSD 5.1.
// All timestamps are UTC epoch milliseconds (integer). Date-only values are
// `YYYY-MM-DD` strings (KST). IDs are UUIDv7 strings.
// PRD "회차(Session)" is called `round` in code (TSD 5).
import { sql } from "drizzle-orm";
import {
  blob,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const members = sqliteTable("members", {
  id: text("id").primaryKey(),
  // NULL after withdrawal (TSD 5.2). SQLite UNIQUE allows many NULLs.
  discordUserId: text("discord_user_id").unique(),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
  isGuildMember: integer("is_guild_member", { mode: "boolean" }).notNull().default(true),
  verifiedAt: integer("verified_at").notNull(),
  withdrawnAt: integer("withdrawn_at"),
  createdAt: integer("created_at").notNull(),
  // JSON array of the member's guild role IDs at the last Discord check (login,
  // 24h re-verification, refresh-roles). NULL until the first check after
  // migration 0002, and after withdrawal. Lets a new study / a role change
  // recompute study_members immediately (TD-23, TSD 3.2).
  discordRoleIds: text("discord_role_ids"),
});

export const discordTokens = sqliteTable("discord_tokens", {
  memberId: text("member_id")
    .primaryKey()
    .references(() => members.id, { onDelete: "cascade" }),
  accessTokenEnc: text("access_token_enc").notNull(),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  accessExpiresAt: integer("access_expires_at").notNull(),
});

export const opsState = sqliteTable("ops_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const authSessions = sqliteTable(
  "auth_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("auth_sessions_member_idx").on(t.memberId)],
);

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  nameKey: text("name_key").notNull().unique(),
  archivedAt: integer("archived_at"),
  // NULL only for the seeded "기타" category (created by the system).
  createdBy: text("created_by").references(() => members.id),
  createdAt: integer("created_at").notNull(),
});

export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  nameKey: text("name_key").notNull().unique(),
});

export const studies = sqliteTable(
  "studies",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    goal: text("goal").notNull(),
    description: text("description"),
    materials: text("materials"),
    cadence: text("cadence"),
    status: text("status", { enum: ["active", "ended"] }).notNull().default("active"),
    // Membership = holding this Discord role (D-23, TD-23). Linked by an admin.
    discordRoleId: text("discord_role_id").notNull().unique(),
    // Markdown shown to non-members: how to get the role (D-23).
    joinGuide: text("join_guide"),
    hiddenAt: integer("hidden_at"),
    hiddenBy: text("hidden_by").references(() => members.id),
    version: integer("version").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    check("studies_status_chk", sql`${t.status} IN ('active', 'ended')`),
  ],
);

/**
 * Cache of Discord role membership (TD-23). Recomputed on login, the 24h
 * re-verification and POST /api/me/refresh-roles; never edited directly.
 */
export const studyMembers = sqliteTable(
  "study_members",
  {
    studyId: text("study_id")
      .notNull()
      .references(() => studies.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    joinedAt: integer("joined_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.studyId, t.memberId] }),
    index("study_members_member_idx").on(t.memberId),
  ],
);

export const rounds = sqliteTable(
  "rounds",
  {
    id: text("id").primaryKey(),
    studyId: text("study_id")
      .notNull()
      .references(() => studies.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    title: text("title").notNull(),
    scope: text("scope").notNull(),
    goal: text("goal").notNull(),
    periodStart: text("period_start"),
    periodEnd: text("period_end"),
    meetingAt: integer("meeting_at"),
    location: text("location"),
    materials: text("materials"),
    status: text("status", { enum: ["active", "ended"] }).notNull().default("active"),
    infoVersion: integer("info_version").notNull().default(1),
    infoUpdatedBy: text("info_updated_by").references(() => members.id),
    infoUpdatedAt: integer("info_updated_at"),
    notesDiscussion: text("notes_discussion"),
    notesOpenQuestions: text("notes_open_questions"),
    notesNextActions: text("notes_next_actions"),
    notesVersion: integer("notes_version").notNull().default(1),
    notesUpdatedBy: text("notes_updated_by").references(() => members.id),
    notesUpdatedAt: integer("notes_updated_at"),
    createdBy: text("created_by")
      .notNull()
      .references(() => members.id),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("rounds_study_seq_uq").on(t.studyId, t.seq),
    index("rounds_meeting_idx").on(t.meetingAt),
    check("rounds_status_chk", sql`${t.status} IN ('active', 'ended')`),
  ],
);

export const posts = sqliteTable(
  "posts",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id),
    authorId: text("author_id")
      .notNull()
      .references(() => members.id),
    roundId: text("round_id").references(() => rounds.id, { onDelete: "set null" }),
    // JSON array of {url, label}
    links: text("links").notNull().default("[]"),
    hiddenAt: integer("hidden_at"),
    hiddenBy: text("hidden_by").references(() => members.id),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    // (created_at, id) serves both "newest first" and the cursor pagination.
    index("posts_created_idx").on(t.createdAt, t.id),
    index("posts_category_created_idx").on(t.categoryId, t.createdAt),
    index("posts_round_idx").on(t.roundId),
    index("posts_author_idx").on(t.authorId),
  ],
);

export const postTags = sqliteTable(
  "post_tags",
  {
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id),
  },
  (t) => [primaryKey({ columns: [t.postId, t.tagId] }), index("post_tags_tag_idx").on(t.tagId)],
);

export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    postId: text("post_id").references(() => posts.id, { onDelete: "cascade" }),
    roundId: text("round_id").references(() => rounds.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => members.id),
    body: text("body").notNull(),
    hiddenAt: integer("hidden_at"),
    hiddenBy: text("hidden_by").references(() => members.id),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("comments_post_idx").on(t.postId, t.createdAt),
    index("comments_round_idx").on(t.roundId, t.createdAt),
    // Exactly one parent (TSD 5.1).
    check("comments_one_parent_chk", sql`(${t.postId} IS NULL) <> (${t.roundId} IS NULL)`),
  ],
);

/**
 * The one HTML file attached to a post (D-30, TD-25). Separate from `posts` so
 * list queries never read the large value. Served only by the isolated worker
 * (TD-26). Not searchable (TSD 3.2).
 */
export const postHtml = sqliteTable(
  "post_html",
  {
    postId: text("post_id")
      .primaryKey()
      .references(() => posts.id, { onDelete: "cascade" }),
    html: text("html").notNull(),
    filename: text("filename").notNull(),
    /** Total UTF-8 bytes of the file (`html` plus every chunk). */
    size: integer("size").notNull(),
    uploadedAt: integer("uploaded_at").notNull(),
    uploadedVia: text("uploaded_via", { enum: ["site", "discord"] }).notNull(),
    /** The Discord message the file came from (D-32); makes the message command idempotent. */
    discordMessageId: text("discord_message_id").unique(),
    /** Number of extra pieces in `post_html_chunks` (seq 1..n) after `html`, the first piece (TD-25, migration 0004). */
    chunkCount: integer("chunk_count").notNull().default(0),
    /**
     * How the file is stored (TD-25, migration 0005). `identity`: UTF-8 text in
     * `html` + `post_html_chunks`. `gzip`: gzip bytes in `post_html_blobs`, with
     * `html` = '' and `chunk_count` = 0; `size` is still the original size.
     */
    encoding: text("encoding", { enum: ["identity", "gzip"] }).notNull().default("identity"),
    /** Bytes actually stored: the gzip size for `gzip`, `size` for `identity`. Nullable only because ADD COLUMN; 0005 backfills it and every write sets it. */
    storedSize: integer("stored_size"),
  },
  (t) => [
    check("post_html_uploaded_via_chk", sql`${t.uploadedVia} IN ('site', 'discord')`),
    check("post_html_encoding_chk", sql`${t.encoding} IN ('identity', 'gzip')`),
  ],
);

/**
 * Pieces 1..n of an attached HTML file larger than one D1 value (TD-25,
 * migration 0004). Piece 0 is `post_html.html`. Each piece is at most
 * 1,900,000 UTF-8 bytes, cut at a character boundary. Written and deleted only
 * together with its `post_html` row (one batch).
 */
export const postHtmlChunks = sqliteTable(
  "post_html_chunks",
  {
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    data: text("data").notNull(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.seq] }), check("post_html_chunks_seq_chk", sql`${t.seq} >= 1`)],
);

/**
 * The gzip bytes of a `post_html` row with `encoding = 'gzip'` (TD-25,
 * migration 0005), in pieces seq 0..n of at most 950,000 bytes so each
 * piece's hex form (how it is written and read, 3.2) stays under the D1 value
 * cap. Written and deleted only together with its `post_html` row (one batch).
 */
export const postHtmlBlobs = sqliteTable(
  "post_html_blobs",
  {
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    data: blob("data", { mode: "buffer" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.seq] }), check("post_html_blobs_seq_chk", sql`${t.seq} >= 0`)],
);

export type MemberRow = typeof members.$inferSelect;
export type PostRow = typeof posts.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;
export type CategoryRow = typeof categories.$inferSelect;
export type StudyRow = typeof studies.$inferSelect;
export type RoundRow = typeof rounds.$inferSelect;
