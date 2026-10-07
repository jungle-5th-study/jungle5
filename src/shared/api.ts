// Response types of the JSON API (shared with the SPA).
import type { Link } from "./schemas";

export type { ApiErrorBody, ErrorCode, FieldErrors } from "./errors";

/** Author/member as shown to others. Withdrawn members have null name/avatar (D-20). */
export interface MemberSummary {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  withdrawn: boolean;
}

/** A study I belong to, i.e. whose Discord role I had at the last check (D-23). */
export interface MyStudy {
  id: string;
  name: string;
  status: "active" | "ended";
}

export interface Me {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
  studies: MyStudy[];
}

export interface Category {
  id: string;
  name: string;
  archived: boolean;
  createdAt: number;
}

/** GET /api/categories item: a category plus its number of posts that are not hidden (UD-14). */
export interface CategoryWithCount extends Category {
  postCount: number;
}

/**
 * GET /api/categories. Ordered by postCount desc, then name asc (UD-14).
 * Includes archived categories. `totalPosts` = all posts that are not hidden.
 */
export interface CategoryList {
  items: CategoryWithCount[];
  totalPosts: number;
}

/** An attached HTML file's metadata (D-30). The content itself is only served by the isolated worker (TD-26). */
export interface PostHtmlMeta {
  filename: string;
  /** Original (uncompressed) UTF-8 bytes */
  size: number;
  uploadedAt: number;
  /** Stored gzip-compressed (a site upload since TD-25 gzip, migration 0005). */
  compressed: boolean;
}

/** GET /api/posts/:id/html-url: a signed URL on the isolated HTML origin (TD-26). */
export interface PostHtmlUrl {
  url: string;
  /** epoch ms */
  expiresAt: number;
}

export interface PostListItem {
  id: string;
  title: string;
  excerpt: string;
  category: { id: string; name: string };
  author: MemberSummary;
  tags: string[];
  roundId: string | null;
  /** The linked round (F-08). null when unlinked, or when its study is hidden from the viewer. */
  round: PostRound | null;
  commentCount: number;
  /** The attached HTML file, if any (D-30). */
  html: PostHtmlMeta | null;
  /** true only when the viewer may see hidden content (admin or author, TD-17). */
  hidden: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Comment {
  id: string;
  postId: string | null;
  roundId: string | null;
  author: MemberSummary;
  body: string;
  hidden: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PostDetail {
  id: string;
  title: string;
  body: string;
  category: { id: string; name: string; archived: boolean };
  author: MemberSummary;
  tags: string[];
  links: Link[];
  roundId: string | null;
  /** The linked round (F-08). null when unlinked, or when its study is hidden from the viewer. */
  round: PostRound | null;
  /** The attached HTML file, if any (D-30). Open it via GET /api/posts/:id/html-url. */
  html: PostHtmlMeta | null;
  hidden: boolean;
  createdAt: number;
  updatedAt: number;
  comments: Comment[];
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** A post's linked round, as shown on post lists and the post page. */
export interface PostRound {
  id: string;
  seq: number;
  title: string;
  studyId: string;
  studyName: string;
}

/** GET /api/me/linkable-rounds item: an active round of one of my active studies. */
export type LinkableRound = PostRound;

/** A meeting of one of my active studies in the current KST week (home). */
export interface NextMeeting {
  roundId: string;
  studyId: string;
  studyName: string;
  seq: number;
  title: string;
  /** First LIMITS.scopeExcerpt characters of the round's scope (Markdown). */
  scope: string;
  location: string | null;
  meetingAt: number;
  roundStatus: Status;
  /** Linked posts that are not hidden (same count for every viewer). */
  linkedPostCount: number;
}

export interface Home {
  /** Rounds of my active studies meeting this KST week (Mon 00:00 – next Mon 00:00), ascending. */
  nextMeetings: NextMeeting[];
  recentPosts: PostListItem[];
}

// ---- studies & rounds (M2) ----

export type Status = "active" | "ended";

/** A round in a list (study page, study list). */
export interface RoundRef {
  id: string;
  seq: number;
  title: string;
  meetingAt: number | null;
  status: Status;
}

/** GET /api/studies item. */
export interface StudyListItem {
  id: string;
  name: string;
  goal: string;
  cadence: string | null;
  status: Status;
  /** Only admins ever receive hidden studies; then true. */
  hidden: boolean;
  isMember: boolean;
  memberCount: number;
  /** Highest-numbered round, if any. */
  latestRound: RoundRef | null;
  /** The earliest round whose meeting is still ahead (meetingAt >= now), if any. */
  nextMeeting: RoundRef | null;
}

export interface StudyList {
  /** My studies (active) first, then other active studies, then ended ones (mine first); by name within a group. */
  items: StudyListItem[];
}

/** What the viewer may do on a study page (derived from policies.ts; the SPA should not re-derive). */
export interface StudyPermissions {
  /** PATCH /api/studies/:id */
  canEdit: boolean;
  /** POST /api/studies/:id/rounds */
  canCreateRound: boolean;
  /** Admin: end/reopen, change the Discord role, hide/unhide. */
  canManage: boolean;
}

export interface StudyDetail {
  id: string;
  name: string;
  goal: string;
  description: string | null;
  materials: string | null;
  cadence: string | null;
  /** Markdown shown to non-members: how to get the Discord role (D-23). */
  joinGuide: string | null;
  discordRoleId: string;
  status: Status;
  hidden: boolean;
  /** Send back as `version` on PATCH (TD-14). */
  version: number;
  createdAt: number;
  updatedAt: number;
  isMember: boolean;
  /** Current members (Discord role holders still in the guild), by join time. */
  members: MemberSummary[];
  /** All rounds, seq ascending. */
  rounds: RoundRef[];
  permissions: StudyPermissions;
}

/** The round itself (info + shared notes). Returned by create, PATCH, end/reopen and in conflicts. */
export interface Round {
  id: string;
  studyId: string;
  seq: number;
  title: string;
  /** Markdown */
  scope: string;
  goal: string;
  /** YYYY-MM-DD (KST) */
  periodStart: string | null;
  periodEnd: string | null;
  meetingAt: number | null;
  location: string | null;
  /** Markdown */
  materials: string | null;
  status: Status;
  /** Send back as `infoVersion` on PATCH /info (TD-14). */
  infoVersion: number;
  infoUpdatedBy: MemberSummary | null;
  infoUpdatedAt: number | null;
  notesDiscussion: string | null;
  notesOpenQuestions: string | null;
  notesNextActions: string | null;
  /** Send back as `notesVersion` on PATCH /notes (TD-14). */
  notesVersion: number;
  notesUpdatedBy: MemberSummary | null;
  notesUpdatedAt: number | null;
  createdBy: MemberSummary;
  createdAt: number;
}

/** What the viewer may do on a round page (derived from policies.ts). */
export interface RoundPermissions {
  /** PATCH /info */
  canEditInfo: boolean;
  /** PATCH /notes */
  canWriteNotes: boolean;
  /** POST /end, /reopen */
  canSetStatus: boolean;
  /** DELETE: permitted AND the round is empty (no linked posts, comments or notes). */
  canDelete: boolean;
  /** Whether the viewer may link their own posts to this round (D-15). */
  canLink: boolean;
  /** POST /api/rounds/:id/comments (allowed on ended rounds too). */
  canComment: boolean;
}

export interface RoundDetail extends Round {
  study: { id: string; name: string; status: Status; hidden: boolean };
  isMember: boolean;
  /** Linked posts, newest first; hidden ones only for admins/authors (TD-17). */
  posts: PostListItem[];
  comments: Comment[];
  /** The closest earlier round of the same study (normally seq - 1), read-only carry-over (F-09). */
  previous: {
    id: string;
    seq: number;
    title: string;
    notesOpenQuestions: string | null;
    notesNextActions: string | null;
  } | null;
  permissions: RoundPermissions;
}
