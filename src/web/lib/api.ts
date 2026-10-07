// Fetch wrapper for the JSON API (TSD 6.2, 7). All requests are same-origin
// with the session cookie; mutating requests always carry
// `Content-Type: application/json` because the CSRF guard requires it, even
// for bodiless DELETEs.
import type { ApiErrorBody, ErrorCode, FieldErrors } from "../../shared/api";

/** Client-side codes for failures that never reached the API envelope. */
export type ClientErrorCode = "NETWORK" | "UNKNOWN";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | ClientErrorCode;
  readonly fields: FieldErrors;
  readonly existing: unknown;
  readonly latest: unknown;
  /** RATE_LIMITED: seconds until the next attempt is allowed. */
  readonly retryAfterSeconds: number | undefined;

  constructor(
    status: number,
    code: ErrorCode | ClientErrorCode,
    message: string,
    extra: Omit<ApiErrorBody["error"], "code" | "message"> = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = extra.fields ?? {};
    this.existing = extra.existing;
    this.latest = extra.latest;
    this.retryAfterSeconds = extra.retryAfterSeconds;
  }

  /** The session is gone or the member left the Discord server: go to /login. */
  get isAuthError(): boolean {
    return this.status === 401;
  }
}

export type UnauthorizedHandler = (code: ErrorCode | ClientErrorCode) => void;
let onUnauthorized: UnauthorizedHandler | null = null;

/** Registered once by the app shell; called for every 401 response. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
}

function isErrorBody(v: unknown): v is ApiErrorBody {
  if (typeof v !== "object" || v === null || !("error" in v)) return false;
  const e: unknown = v.error;
  return typeof e === "object" && e !== null && typeof (e as { code?: unknown }).code === "string";
}

/** Maps a non-2xx response to an ApiError (never throws itself). */
export async function errorFromResponse(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Not JSON (e.g. an HTML error page from a proxy).
  }
  if (isErrorBody(body)) {
    const { code, message, ...extra } = body.error;
    return new ApiError(res.status, code, message || defaultMessage(res.status), extra);
  }
  return new ApiError(res.status, "UNKNOWN", defaultMessage(res.status));
}

function defaultMessage(status: number): string {
  if (status === 401) return "로그인이 필요합니다";
  if (status === 403) return "권한이 없습니다";
  if (status === 404) return "찾을 수 없습니다";
  if (status >= 500) return "서버 오류가 발생했습니다. 잠시 후 다시 시도하세요";
  return "요청을 처리하지 못했습니다";
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

/** Calls the API and returns the parsed JSON (undefined for 204). Throws ApiError. */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (MUTATING.has(method)) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "NETWORK", "네트워크 오류로 요청하지 못했습니다. 연결을 확인하고 다시 시도하세요");
  }

  if (!res.ok) {
    const error = await errorFromResponse(res);
    if (error.isAuthError) onUnauthorized?.(error.code);
    throw error;
  }
  if (res.status === 204) return undefined as T;
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(res.status, "UNKNOWN", "서버 응답을 읽지 못했습니다");
  }
}

/** First message for a field path (e.g. "title", "links.0.url"). */
export function fieldError(fields: FieldErrors, path: string): string | undefined {
  return fields[path]?.[0];
}

/** Status-blocked actions (409): fixed Korean messages so the cause is always clear. */
const STATUS_MESSAGES: Partial<Record<ErrorCode, string>> = {
  ROUND_NOT_EMPTY: "연결된 글, 댓글 또는 모임 기록이 있는 회차는 삭제할 수 없습니다.",
  ROUND_ENDED: "종료된 회차입니다. 회차를 재개한 뒤 편집하거나 글을 연결하세요.",
  STUDY_ENDED: "종료된 스터디입니다. 운영자가 재개하면 다시 편집할 수 있습니다.",
};

/** A user-facing message for any thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return STATUS_MESSAGES[err.code as ErrorCode] ?? err.message;
  return "알 수 없는 오류가 발생했습니다";
}
