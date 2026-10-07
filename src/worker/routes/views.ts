// Read-side query builders and row → API mappers shared by the routes.
import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Comment, MemberSummary, PostDetail, PostHtmlMeta, PostListItem, PostRound } from "../../shared/api";
import type { Link } from "../../shared/schemas";
import { categories, comments, members, postHtml, posts, postTags, rounds, studies, tags } from "../db/schema";
import { canViewStudy, type Actor } from "../policies";
import type { Db } from "../types";

export function memberSummary(m: {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  withdrawnAt: number | null;
}): MemberSummary {
  const withdrawn = m.withdrawnAt !== null;
  return {
    id: m.id,
    // Defense in depth: withdrawn rows are already NULLed (TSD 5.2).
    displayName: withdrawn ? null : m.displayName,
    avatarUrl: withdrawn ? null : m.avatarUrl,
    withdrawn,
  };
}

const authorColumns = {
  authorId: members.id,
  authorName: members.displayName,
  authorAvatar: members.avatarUrl,
  authorWithdrawnAt: members.withdrawnAt,
};

const authorOf = (r: {
  authorId: string;
  authorName: string | null;
  authorAvatar: string | null;
  authorWithdrawnAt: number | null;
}) =>
  memberSummary({
    id: r.authorId,
    displayName: r.authorName,
    avatarUrl: r.authorAvatar,
    withdrawnAt: r.authorWithdrawnAt,
  });

/** TD-17: admins and authors see hidden posts; everyone else does not. */
export function postVisibility(actor: Actor): SQL | undefined {
  return actor.isAdmin ? undefined : or(isNull(posts.hiddenAt), eq(posts.authorId, actor.id));
}

export function commentVisibility(actor: Actor): SQL | undefined {
  return actor.isAdmin ? undefined : or(isNull(comments.hiddenAt), eq(comments.authorId, actor.id));
}

/** Columns for a post's linked round; use with `roundJoins`. */
const roundColumns = {
  linkedRoundId: rounds.id,
  linkedRoundSeq: rounds.seq,
  linkedRoundTitle: rounds.title,
  linkedStudyId: studies.id,
  linkedStudyName: studies.name,
  linkedStudyHiddenAt: studies.hiddenAt,
};

/** The post's round summary; null when unlinked or its study is hidden from the viewer. */
function roundOf(
  actor: Actor,
  r: {
    linkedRoundId: string | null;
    linkedRoundSeq: number | null;
    linkedRoundTitle: string | null;
    linkedStudyId: string | null;
    linkedStudyName: string | null;
    linkedStudyHiddenAt: number | null;
  },
): PostRound | null {
  if (r.linkedRoundId === null || r.linkedStudyId === null) return null;
  if (!canViewStudy(actor, { hiddenAt: r.linkedStudyHiddenAt })) return null;
  return {
    id: r.linkedRoundId,
    seq: r.linkedRoundSeq ?? 0,
    title: r.linkedRoundTitle ?? "",
    studyId: r.linkedStudyId,
    studyName: r.linkedStudyName ?? "",
  };
}

/**
 * Metadata of the attached HTML (never the content); use with
 * `.leftJoin(postHtml, eq(postHtml.postId, posts.id))`.
 */
const htmlColumns = {
  htmlFilename: postHtml.filename,
  htmlSize: postHtml.size,
  htmlUploadedAt: postHtml.uploadedAt,
  htmlEncoding: postHtml.encoding,
};

function htmlOf(r: {
  htmlFilename: string | null;
  htmlSize: number | null;
  htmlUploadedAt: number | null;
  htmlEncoding: "identity" | "gzip" | null;
}): PostHtmlMeta | null {
  if (r.htmlFilename === null) return null;
  return {
    filename: r.htmlFilename,
    size: r.htmlSize ?? 0,
    uploadedAt: r.htmlUploadedAt ?? 0,
    compressed: r.htmlEncoding === "gzip",
  };
}

/** Escapes LIKE wildcards; use with `ESCAPE '\'` (TSD 7.2). */
export function likeContains(term: string): string {
  return `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export function encodeCursor(createdAt: number, id: string): string {
  return btoa(`${createdAt}:${id}`).replace(/=+$/, "");
}

export function decodeCursor(cursor: string): { createdAt: number; id: string } | null {
  try {
    const raw = atob(cursor);
    const sep = raw.indexOf(":");
    const createdAt = Number(raw.slice(0, sep));
    const id = raw.slice(sep + 1);
    if (sep < 1 || !Number.isSafeInteger(createdAt) || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/**
 * Post list rows (newest first) + their tags. 2 queries.
 * `filters` are ANDed with the viewer's visibility rule.
 */
export async function listPosts(
  db: Db,
  actor: Actor,
  filters: (SQL | undefined)[],
  limit: number,
): Promise<{ items: PostListItem[]; hasMore: boolean }> {
  const viewerSeesHiddenComments = actor.isAdmin ? sql`1` : sql`(c.hidden_at IS NULL OR c.author_id = ${actor.id})`;
  const rows = await db
    .select({
      id: posts.id,
      title: posts.title,
      excerpt: sql<string>`substr(${posts.body}, 1, 200)`,
      categoryId: posts.categoryId,
      categoryName: categories.name,
      ...authorColumns,
      roundId: posts.roundId,
      ...roundColumns,
      ...htmlColumns,
      hiddenAt: posts.hiddenAt,
      createdAt: posts.createdAt,
      updatedAt: posts.updatedAt,
      commentCount: sql<number>`(SELECT count(*) FROM comments c WHERE c.post_id = ${posts.id} AND ${viewerSeesHiddenComments})`,
    })
    .from(posts)
    .innerJoin(members, eq(members.id, posts.authorId))
    .innerJoin(categories, eq(categories.id, posts.categoryId))
    .leftJoin(rounds, eq(rounds.id, posts.roundId))
    .leftJoin(studies, eq(studies.id, rounds.studyId))
    .leftJoin(postHtml, eq(postHtml.postId, posts.id))
    .where(and(postVisibility(actor), ...filters))
    .orderBy(desc(posts.createdAt), desc(posts.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const tagMap = await loadTagNames(
    db,
    page.map((r) => r.id),
  );
  return {
    hasMore,
    items: page.map((r) => ({
      id: r.id,
      title: r.title,
      excerpt: r.excerpt,
      category: { id: r.categoryId, name: r.categoryName },
      author: authorOf(r),
      tags: tagMap.get(r.id) ?? [],
      roundId: r.roundId,
      round: roundOf(actor, r),
      commentCount: Number(r.commentCount),
      html: htmlOf(r),
      hidden: r.hiddenAt !== null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  };
}

async function loadTagNames(db: Db, postIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (postIds.length === 0) return map;
  const rows = await db
    .select({ postId: postTags.postId, name: tags.name })
    .from(postTags)
    .innerJoin(tags, eq(tags.id, postTags.tagId))
    .where(inArray(postTags.postId, postIds))
    .orderBy(asc(tags.name));
  for (const r of rows) {
    const list = map.get(r.postId) ?? [];
    list.push(r.name);
    map.set(r.postId, list);
  }
  return map;
}

/**
 * Post detail incl. tags and visible comments (3 queries, issued concurrently).
 * null = not found or not visible.
 * Note: not `db.batch()` — Drizzle's D1 batch maps joined rows by column name,
 * so same-named columns (posts.id / members.id) would collide.
 */
export async function loadPostDetail(db: Db, actor: Actor, id: string): Promise<PostDetail | null> {
  const [postRows, tagRows, commentRows] = await Promise.all([
    db
      .select({
        post: posts,
        categoryName: categories.name,
        categoryArchivedAt: categories.archivedAt,
        ...authorColumns,
        ...roundColumns,
        ...htmlColumns,
      })
      .from(posts)
      .innerJoin(members, eq(members.id, posts.authorId))
      .innerJoin(categories, eq(categories.id, posts.categoryId))
      .leftJoin(rounds, eq(rounds.id, posts.roundId))
      .leftJoin(studies, eq(studies.id, rounds.studyId))
      .leftJoin(postHtml, eq(postHtml.postId, posts.id))
      .where(and(eq(posts.id, id), postVisibility(actor))),
    db
      .select({ name: tags.name })
      .from(postTags)
      .innerJoin(tags, eq(tags.id, postTags.tagId))
      .where(eq(postTags.postId, id))
      .orderBy(asc(tags.name)),
    commentSelect(db)
      .where(and(eq(comments.postId, id), commentVisibility(actor)))
      .orderBy(asc(comments.createdAt), asc(comments.id)),
  ]);
  const row = postRows[0];
  if (!row) return null;
  const p = row.post;
  return {
    id: p.id,
    title: p.title,
    body: p.body,
    category: { id: p.categoryId, name: row.categoryName, archived: row.categoryArchivedAt !== null },
    author: authorOf(row),
    tags: tagRows.map((t) => t.name),
    links: parseLinks(p.links),
    roundId: p.roundId,
    round: roundOf(actor, row),
    html: htmlOf(row),
    hidden: p.hiddenAt !== null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    comments: commentRows.map(toComment),
  };
}

export function parseLinks(json: string): Link[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? (v as Link[]) : [];
  } catch {
    return [];
  }
}

export function commentSelect(db: Db) {
  return db
    .select({
      id: comments.id,
      postId: comments.postId,
      roundId: comments.roundId,
      body: comments.body,
      hiddenAt: comments.hiddenAt,
      createdAt: comments.createdAt,
      updatedAt: comments.updatedAt,
      ...authorColumns,
    })
    .from(comments)
    .innerJoin(members, eq(members.id, comments.authorId));
}

type CommentSelectRow = Awaited<ReturnType<ReturnType<typeof commentSelect>["all"]>>[number];

export function toComment(r: CommentSelectRow): Comment {
  return {
    id: r.id,
    postId: r.postId,
    roundId: r.roundId,
    author: authorOf(r),
    body: r.body,
    hidden: r.hiddenAt !== null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function isUniqueViolation(err: unknown): boolean {
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : "";
  const msg = err instanceof Error ? `${err.message} ${cause}` : "";
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT_PRIMARYKEY|PRIMARY KEY/i.test(msg);
}
