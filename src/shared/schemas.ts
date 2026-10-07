// Input validation shared by the Worker (authoritative) and the SPA (UX).
import { z } from "zod";
import { HTML_EXTENSIONS, LIMITS } from "./constants";

/** UUIDv7, normalized to lower case so the PK check in TD-13 is case-proof. */
export const idSchema = z
  .uuid({ version: "v7", message: "UUIDv7 형식이어야 합니다" })
  .transform((s) => s.toLowerCase());

/** Any UUID (used for references such as categoryId; the seed id is a v7 too). */
export const refIdSchema = z.uuid({ message: "올바른 ID가 아닙니다" }).transform((s) => s.toLowerCase());

const requiredText = (max: number) =>
  z.string().trim().min(1, "필수 항목입니다").max(max, `${max}자 이하로 입력하세요`);

// ---- links (C-09: http/https only, at most 10) ----
export const linkSchema = z.object({
  url: z
    .url({ protocol: /^https?$/, message: "http 또는 https 주소만 허용됩니다" })
    .max(LIMITS.linkUrlMax),
  label: z.string().trim().max(LIMITS.linkLabelMax).optional().default(""),
});
export type Link = z.infer<typeof linkSchema>;
const linksSchema = z.array(linkSchema).max(LIMITS.linksMax, `링크는 최대 ${LIMITS.linksMax}개입니다`);

const tagsSchema = z
  .array(requiredText(LIMITS.tagNameMax))
  .max(LIMITS.tagsMax, `태그는 최대 ${LIMITS.tagsMax}개입니다`);

// ---- categories ----
export const categoryCreateSchema = z.object({
  name: requiredText(LIMITS.categoryNameMax),
});
export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;

export const categoryPatchSchema = z
  .object({
    name: requiredText(LIMITS.categoryNameMax).optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => v.name !== undefined || v.archived !== undefined, {
    message: "변경할 항목이 없습니다",
  });
export type CategoryPatchInput = z.infer<typeof categoryPatchSchema>;

// ---- attached HTML file (D-30, TD-25) ----

/** True when `name` ends in .html/.htm (any case). */
export function hasHtmlExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return HTML_EXTENSIONS.some((ext) => lower.endsWith(ext) && lower.length > ext.length);
}

/** "파일은 10MB 이하만 올릴 수 있습니다" (D-30). */
export const HTML_TOO_LARGE_MESSAGE = `파일은 ${LIMITS.htmlMaxBytes / 1_000_000}MB 이하만 올릴 수 있습니다`;

/**
 * Name of an attached HTML file. The file itself is not JSON: PUT
 * /api/posts/:id/html takes the raw bytes (TD-25, TSD 3.2), and the server
 * checks them as strict UTF-8 without U+0000.
 */
export const htmlFilenameSchema = z
  .string()
  .trim()
  .min(1, "필수 항목입니다")
  .max(LIMITS.htmlFilenameMax, `${LIMITS.htmlFilenameMax}자 이하로 입력하세요`)
  // eslint-disable-next-line no-control-regex
  .refine((n) => !/[\\/\u0000-\u001f\u007f]/.test(n), "파일 이름에 쓸 수 없는 문자가 있습니다")
  .refine(hasHtmlExtension, ".html 또는 .htm 파일만 올릴 수 있습니다");

// ---- posts (D-22: no kinds; a post is title/body/category/tags/links/round) ----
const postFields = {
  title: requiredText(LIMITS.postTitleMax),
  body: z.string().min(1, "필수 항목입니다").max(LIMITS.postBodyMax, `${LIMITS.postBodyMax}자 이하로 입력하세요`),
  categoryId: refIdSchema,
  tags: tagsSchema,
  links: linksSchema,
};

export const postCreateSchema = z.object({
  id: idSchema,
  ...postFields,
  tags: postFields.tags.optional().default([]),
  links: postFields.links.optional().default([]),
  /** Round link at creation time (F-08): the author must be a member of the round's study. */
  roundId: refIdSchema.nullable().optional(),
  /**
   * Removed (TD-25, 10 MB files): create the post, then PUT /api/posts/:id/html
   * with the raw file. Rejected instead of silently dropped, for SPA bundles
   * still open from before the change.
   */
  html: z.never({ error: "페이지를 새로 고친 뒤 다시 저장해 주세요" }).optional(),
});
export type PostCreateInput = z.input<typeof postCreateSchema>;

export const postPatchSchema = z.object({
  title: postFields.title.optional(),
  body: postFields.body.optional(),
  categoryId: postFields.categoryId.optional(),
  tags: postFields.tags.optional(),
  links: postFields.links.optional(),
});
export type PostPatchInput = z.input<typeof postPatchSchema>;

export const postRoundSchema = z.object({ roundId: refIdSchema.nullable() });

/** GET /api/posts query (TSD 7.1, 7.2). */
export const postListQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(LIMITS.searchMin, `검색어는 ${LIMITS.searchMin}자 이상입니다`)
    .max(LIMITS.searchMax, `검색어는 ${LIMITS.searchMax}자 이하입니다`)
    .optional(),
  category: refIdSchema.optional(),
  tag: z.string().trim().min(1).max(LIMITS.tagNameMax).optional(),
  round: refIdSchema.optional(),
  cursor: z.string().max(200).optional(),
});
export type PostListQuery = z.infer<typeof postListQuerySchema>;

// ---- comments ----
export const commentCreateSchema = z.object({
  id: idSchema,
  body: requiredText(LIMITS.commentBodyMax),
});
export type CommentCreateInput = z.input<typeof commentCreateSchema>;

export const commentPatchSchema = z.object({
  body: requiredText(LIMITS.commentBodyMax),
});
export type CommentPatchInput = z.input<typeof commentPatchSchema>;

// ---- studies (F-05, D-23, D-24) ----

/**
 * Optional free text. On create: omitted/""/null → null. On PATCH: omitted =
 * unchanged, ""/null = clear.
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `${max}자 이하로 입력하세요`)
    .nullable()
    .transform((s) => (s === null || s === "" ? null : s));

/** Discord snowflake: 17–20 digits ("ID 복사" in Discord developer mode). */
export const discordRoleIdSchema = z
  .string()
  .trim()
  .regex(/^\d{17,20}$/, "Discord 역할 ID(17~20자리 숫자)를 입력하세요");

const studyInfoFields = {
  name: requiredText(LIMITS.studyNameMax),
  goal: requiredText(LIMITS.studyGoalMax),
  description: optionalText(LIMITS.markdownMax),
  materials: optionalText(LIMITS.markdownMax),
  cadence: optionalText(LIMITS.studyCadenceMax),
  joinGuide: optionalText(LIMITS.markdownMax),
};

/** POST /api/studies (admin). `id` is client-generated (TD-13). */
export const studyCreateSchema = z.object({
  id: idSchema,
  name: studyInfoFields.name,
  goal: studyInfoFields.goal,
  discordRoleId: discordRoleIdSchema,
  description: studyInfoFields.description.optional().default(null),
  materials: studyInfoFields.materials.optional().default(null),
  cadence: studyInfoFields.cadence.optional().default(null),
  joinGuide: studyInfoFields.joinGuide.optional().default(null),
});
export type StudyCreateInput = z.input<typeof studyCreateSchema>;

const versionSchema = z.number({ message: "버전이 필요합니다" }).int().min(1);

/** PATCH /api/studies/:id (study member or admin). Omitted fields are unchanged. */
export const studyPatchSchema = z.object({
  version: versionSchema,
  name: studyInfoFields.name.optional(),
  goal: studyInfoFields.goal.optional(),
  description: studyInfoFields.description.optional(),
  materials: studyInfoFields.materials.optional(),
  cadence: studyInfoFields.cadence.optional(),
  joinGuide: studyInfoFields.joinGuide.optional(),
});
export type StudyPatchInput = z.input<typeof studyPatchSchema>;

/** PUT /api/studies/:id/role (admin): link a different Discord role. */
export const studyRoleSchema = z.object({ discordRoleId: discordRoleIdSchema });
export type StudyRoleInput = z.input<typeof studyRoleSchema>;

export const studyListQuerySchema = z.object({
  status: z.enum(["active", "ended"]).optional(),
});

// ---- rounds (F-06, F-09) ----

/** `YYYY-MM-DD` (KST date) that is a real calendar date. */
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식이어야 합니다")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "존재하지 않는 날짜입니다");

const roundInfoFields = {
  title: requiredText(LIMITS.roundTitleMax),
  scope: requiredText(LIMITS.markdownMax),
  goal: requiredText(LIMITS.roundGoalMax),
  periodStart: dateOnly.nullable(),
  periodEnd: dateOnly.nullable(),
  /** Meeting date-time, UTC epoch ms. */
  meetingAt: z.number().int("정수(epoch ms)여야 합니다").min(0).max(8.64e15).nullable(),
  location: optionalText(LIMITS.roundLocationMax),
  materials: optionalText(LIMITS.markdownMax),
};

/** The period must not end before it starts (checked on the merged values for PATCH). */
export function periodOrderError(start: string | null | undefined, end: string | null | undefined): string | null {
  return start && end && end < start ? "학습 기간의 끝이 시작보다 빠릅니다" : null;
}

export const roundCreateSchema = z
  .object({
    id: idSchema,
    title: roundInfoFields.title,
    scope: roundInfoFields.scope,
    goal: roundInfoFields.goal,
    periodStart: roundInfoFields.periodStart.optional().default(null),
    periodEnd: roundInfoFields.periodEnd.optional().default(null),
    meetingAt: roundInfoFields.meetingAt.optional().default(null),
    location: roundInfoFields.location.optional().default(null),
    materials: roundInfoFields.materials.optional().default(null),
  })
  .superRefine((v, ctx) => {
    const msg = periodOrderError(v.periodStart, v.periodEnd);
    if (msg) ctx.addIssue({ code: "custom", path: ["periodEnd"], message: msg });
  });
export type RoundCreateInput = z.input<typeof roundCreateSchema>;

/** PATCH /api/rounds/:id/info. Omitted fields are unchanged; null clears an optional field. */
export const roundInfoPatchSchema = z.object({
  infoVersion: versionSchema,
  title: roundInfoFields.title.optional(),
  scope: roundInfoFields.scope.optional(),
  goal: roundInfoFields.goal.optional(),
  periodStart: roundInfoFields.periodStart.optional(),
  periodEnd: roundInfoFields.periodEnd.optional(),
  meetingAt: roundInfoFields.meetingAt.optional(),
  location: roundInfoFields.location.optional(),
  materials: roundInfoFields.materials.optional(),
});
export type RoundInfoPatchInput = z.input<typeof roundInfoPatchSchema>;

/** PATCH /api/rounds/:id/notes (shared meeting notes, F-09). Omitted = unchanged. */
export const roundNotesPatchSchema = z.object({
  notesVersion: versionSchema,
  notesDiscussion: optionalText(LIMITS.markdownMax).optional(),
  notesOpenQuestions: optionalText(LIMITS.markdownMax).optional(),
  notesNextActions: optionalText(LIMITS.markdownMax).optional(),
});
export type RoundNotesPatchInput = z.input<typeof roundNotesPatchSchema>;
