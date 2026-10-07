// Error envelope shared by the API and the SPA (TSD 7).
export const ERROR_CODES = [
  "UNAUTHENTICATED",
  "NOT_GUILD_MEMBER",
  "FORBIDDEN",
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "DUPLICATE",
  "VALIDATION",
  /** 409: the round has linked posts, comments or notes and cannot be deleted. */
  "ROUND_NOT_EMPTY",
  /** 409: the round is ended; its info/notes are read-only and posts cannot be linked to it. */
  "ROUND_ENDED",
  /** 409: the study is ended; rounds cannot be created, edited, deleted or linked. */
  "STUDY_ENDED",
  "RATE_LIMITED",
  "NOT_IMPLEMENTED",
  "DISCORD_UNAVAILABLE",
  "INTERNAL",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Field path (dot-joined, "" for the root) → messages. */
export type FieldErrors = Record<string, string[]>;

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    /** VALIDATION */
    fields?: FieldErrors;
    /** VERSION_CONFLICT: the latest stored version */
    latest?: unknown;
    /** DUPLICATE: the existing resource (category, or study `{ id, name }` for a taken Discord role) */
    existing?: unknown;
    /** RATE_LIMITED: seconds until the next attempt is allowed (also sent as Retry-After) */
    retryAfterSeconds?: number;
  };
}
