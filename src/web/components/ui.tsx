// Small presentational building blocks shared by the pages (docs/ui.md 6).
// Colors come only from the semantic tokens in styles.css.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router";
import type { MemberSummary } from "../../shared/api";
import { errorMessage } from "../lib/api";
import { formatFull, formatRelative, memberName } from "../lib/format";
import { CloseIcon } from "./icons";

const base =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-semibold whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-10";

export const btn = {
  primary: `${base} bg-primary text-on-primary hover:bg-primary-hover`,
  secondary: `${base} border border-border bg-bg font-medium text-text hover:bg-surface`,
  danger: `${base} border border-danger bg-bg text-danger hover:bg-surface`,
  ghost:
    "inline-flex min-h-11 items-center justify-center gap-1 rounded-lg px-3 text-sm font-medium text-muted hover:bg-surface hover:text-text disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-9",
  /** Square icon button (aria-label required). */
  icon: "inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-text lg:size-10",
  link: "text-sm text-link underline-offset-2 hover:underline",
};

export const input =
  "block w-full rounded-lg border border-border bg-surface px-3 py-2 text-base text-text aria-[invalid=true]:border-danger sm:text-sm";

export const pageTitle = "text-[22px] leading-tight font-bold tracking-[-0.02em] lg:text-[26px]";
export const sectionTitle = "text-lg font-bold";
export const meta = "text-[13px] text-muted";

/** TD-17: shown to admins and the author only (others never receive hidden content). */
export function HiddenBadge() {
  return (
    <span className="rounded border border-border bg-surface px-1.5 py-0.5 text-xs font-medium text-text">운영자가 숨김</span>
  );
}

export function AuthorName({ author }: { author: MemberSummary }) {
  return <span>{memberName(author)}</span>;
}

/** Re-renders once a minute so relative times stay fresh. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function Time({ ms }: { ms: number }) {
  const now = useNow();
  return (
    <time dateTime={new Date(ms).toISOString()} title={formatFull(ms)}>
      {formatRelative(ms, now)}
    </time>
  );
}

export function Spinner({ label = "불러오는 중" }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-muted">
      <span className="size-4 animate-spin rounded-full border-2 border-border border-t-primary" aria-hidden />
      {label}
    </span>
  );
}

/** Grey bars at the height of real list rows, so nothing shifts when data arrives (7). */
export function SkeletonList({ rows = 3, excerpt = true }: { rows?: number; excerpt?: boolean }) {
  return (
    <div role="status" aria-busy="true" aria-label="불러오는 중" className="border-t border-border">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="space-y-2 border-b border-border py-[18px]" aria-hidden>
          <div className="h-5 w-3/5 animate-pulse rounded bg-surface" />
          {excerpt && <div className="h-4 w-full animate-pulse rounded bg-surface" />}
          <div className="h-3.5 w-2/5 animate-pulse rounded bg-surface" />
        </div>
      ))}
    </div>
  );
}

export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded bg-surface ${className}`} />;
}

/** Top-of-section failure notice with what failed and a retry (7). */
export function ErrorState({ error, onRetry, what }: { error: unknown; onRetry?: () => void; what?: string }) {
  return (
    <div role="alert" className="rounded-lg border border-danger p-4 text-sm text-text">
      <p>
        {what && <strong className="text-danger">{what} </strong>}
        {errorMessage(error)}
      </p>
      {onRetry && (
        <button type="button" className={`${btn.secondary} mt-3`} onClick={onRetry}>
          다시 시도
        </button>
      )}
    </div>
  );
}

/** Dashed box + one line + an optional next action (6). */
export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-6 py-8 text-center text-sm text-muted">
      <p>{children}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Alert({ kind = "error", children }: { kind?: "error" | "info" | "success"; children: ReactNode }) {
  const style = {
    error: "border-danger",
    info: "border-border bg-surface",
    success: "border-accent bg-accent-subtle",
  }[kind];
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`rounded-lg border p-3 text-sm text-text ${style}`}>
      {children}
    </div>
  );
}

/** Selected filter with a remove button (6). */
export function FilterChip({ label, removeLabel, onRemove }: { label: ReactNode; removeLabel: string; onRemove: () => void }) {
  return (
    <span className="inline-flex h-[34px] items-center gap-1 rounded-lg bg-accent-subtle pr-1 pl-3 text-sm font-semibold text-accent-subtle-text">
      {label}
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        className="inline-flex size-7 items-center justify-center rounded-md hover:bg-bg/60"
      >
        <CloseIcon />
      </button>
    </span>
  );
}

/**
 * One row of a divider list (6). The title link is stretched over the whole
 * row, so the row is clickable while the link's name stays the title.
 */
export function ListRow({
  to,
  title,
  excerpt,
  meta: metaContent,
  badge,
  titleSuffix,
  compact = false,
}: {
  to: string;
  title: string;
  excerpt?: string;
  meta: ReactNode;
  badge?: ReactNode;
  /** Small marker after the title (e.g. the HTML badge), vertically centred on the title line. */
  titleSuffix?: ReactNode;
  compact?: boolean;
}) {
  return (
    <article className={`group relative flex flex-col border-b border-border px-3 transition-colors hover:bg-surface ${compact ? "gap-0.5 py-3" : "gap-1 py-[18px]"}`}>
      <h3 className={`${compact ? "text-base" : "text-[17px]"} leading-snug font-semibold break-words text-text`}>
        {badge && <span className="mr-2 align-[2px]">{badge}</span>}
        <Link
          to={to}
          className="outline-none group-hover:underline after:absolute after:inset-0 after:rounded focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-accent"
        >
          {title}
        </Link>
        {titleSuffix && <span className="ml-2 inline-flex align-middle">{titleSuffix}</span>}
      </h3>
      {excerpt && <p className="line-clamp-2 text-sm break-words text-muted">{excerpt}</p>}
      <p className={`flex flex-wrap gap-x-1.5 ${meta}`}>{metaContent}</p>
    </article>
  );
}

/** Inline list of meta items separated by "·". */
export function MetaList({ items }: { items: ReactNode[] }) {
  const shown = items.filter((x) => x !== null && x !== undefined && x !== false && x !== "");
  return (
    <>
      {shown.map((item, i) => (
        <span key={i} className="inline-flex gap-x-1.5">
          {i > 0 && <span aria-hidden>·</span>}
          {item}
        </span>
      ))}
    </>
  );
}

const avatarSize = {
  sm: "size-8 text-sm",
  md: "size-9 text-sm",
  lg: "size-14 text-xl",
};

/** Discord avatar; on failure the first letter on accent-subtle; withdrawn members are a grey circle (6). */
export function Avatar({
  name,
  url,
  withdrawn = false,
  size = "md",
}: {
  name: string | null;
  url: string | null;
  withdrawn?: boolean;
  size?: keyof typeof avatarSize;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const cls = `${avatarSize[size]} shrink-0 rounded-full`;
  if (withdrawn) return <span aria-hidden className={`${cls} inline-block border border-border bg-surface`} />;
  if (url && failedUrl !== url) {
    return (
      <img
        src={url}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailedUrl(url)}
        className={`${cls} bg-surface object-cover`}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`${cls} inline-flex items-center justify-center bg-accent-subtle font-bold text-accent-subtle-text`}
    >
      {name?.trim().slice(0, 1) || "?"}
    </span>
  );
}

/**
 * Modal confirmation (keyboard: focus moves to 취소, Tab is trapped, Escape
 * cancels, focus returns to the opener on close).
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  danger = false,
  pending = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  pending?: boolean;
  error?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    return () => opener?.focus();
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !pending) {
      e.stopPropagation();
      onCancel();
      return;
    }
    if (panel.current) trapTab(e, panel.current);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim p-4 sm:items-center">
      <div
        ref={panel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className="w-full max-w-md rounded-xl border border-border bg-bg p-5"
      >
        <h2 id={titleId} className={sectionTitle}>
          {title}
        </h2>
        <div className="mt-2 space-y-2 text-sm text-muted">{children}</div>
        {error && <div className="mt-3">{error}</div>}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button ref={cancelRef} type="button" className={btn.secondary} onClick={onCancel} disabled={pending}>
            취소
          </button>
          <button type="button" className={danger ? btn.danger : btn.primary} onClick={onConfirm} disabled={pending}>
            {pending ? "처리 중…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
}

/** Keeps Tab / Shift+Tab inside `container`. */
export function trapTab(e: KeyboardEvent, container: HTMLElement): void {
  if (e.key !== "Tab") return;
  const items = focusables(container);
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return;
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
