import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";
import type { ApiErrorBody, ErrorCode, FieldErrors } from "../../shared/errors";

/** Thrown by routes/middleware; rendered by the app's onError as the TSD 7 envelope. */
export class AppError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    message: string,
    readonly extra: Omit<ApiErrorBody["error"], "code" | "message"> = {},
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthenticated = (message = "로그인이 필요합니다") =>
  new AppError(401, "UNAUTHENTICATED", message);
export const notGuildMember = () =>
  new AppError(401, "NOT_GUILD_MEMBER", "커뮤니티 멤버만 이용할 수 있습니다");
export const forbidden = (message = "권한이 없습니다") => new AppError(403, "FORBIDDEN", message);
export const notFound = (message = "찾을 수 없습니다") => new AppError(404, "NOT_FOUND", message);
export const rateLimited = (retryAfterSeconds: number, message = "잠시 후 다시 시도하세요") =>
  new AppError(429, "RATE_LIMITED", message, { retryAfterSeconds });
export const discordUnavailable = (message = "Discord에 연결할 수 없습니다. 잠시 후 다시 시도하세요") =>
  new AppError(503, "DISCORD_UNAVAILABLE", message);
export const studyEnded = () =>
  new AppError(409, "STUDY_ENDED", "종료된 스터디입니다. 운영자가 재개하면 다시 편집할 수 있습니다");
export const roundEnded = () =>
  new AppError(409, "ROUND_ENDED", "종료된 회차입니다. 재개한 뒤 편집하거나 글을 연결하세요");
export const roundNotEmpty = () =>
  new AppError(
    409,
    "ROUND_NOT_EMPTY",
    "연결된 글, 댓글 또는 모임 기록이 있는 회차는 삭제할 수 없습니다",
  );
export const versionConflict = (latest: unknown) =>
  new AppError(409, "VERSION_CONFLICT", "다른 멤버가 먼저 저장했습니다", { latest });

/**
 * The error for a denied study/round action. `allowedIfActive` is the same
 * policy evaluated as if the study and round were active: when that passes,
 * the status is the only reason, which gets a specific 409 code; otherwise 403.
 */
export function statusDenial(
  allowedIfActive: boolean,
  studyStatus: "active" | "ended",
  roundStatus?: "active" | "ended",
): AppError {
  if (!allowedIfActive) return forbidden();
  if (studyStatus === "ended") return studyEnded();
  if (roundStatus === "ended") return roundEnded();
  return forbidden();
}

export const validationError = (fields: FieldErrors, message = "입력값을 확인하세요") =>
  new AppError(422, "VALIDATION", message, { fields });

export function zodFieldErrors(error: z.ZodError): FieldErrors {
  const fields: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".");
    (fields[key] ??= []).push(issue.message);
  }
  return fields;
}

export function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw validationError(zodFieldErrors(result.error));
  return result.data;
}

export async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw validationError({ "": ["JSON 본문이 올바르지 않습니다"] });
  }
}

export function errorBody(err: AppError): ApiErrorBody {
  return { error: { code: err.code, message: err.message, ...err.extra } };
}
