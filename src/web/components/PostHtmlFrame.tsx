// An attached HTML file, embedded from the isolated origin (D-30, TD-26).
// The frame gets a 1-hour signed URL from the API. Its sandbox never includes
// allow-same-origin or allow-top-navigation: the HTML runs scripts, so it must
// stay an opaque origin with no access to this site or its cookies.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { PostHtmlMeta, PostHtmlUrl } from "../../shared/api";
import { api, queryKeys } from "../lib/endpoints";
import { formatBytes } from "../lib/htmlFile";
import { btn, ErrorState, Skeleton } from "./ui";

/** Exactly these tokens (TD-26; the HTML worker's CSP sandbox matches). */
export const HTML_FRAME_SANDBOX = "allow-scripts allow-popups allow-forms allow-modals allow-downloads";

/** Fetch a new URL this long before the old one expires. */
export const HTML_URL_REFRESH_MARGIN_MS = 5 * 60_000;

const remaining = (data: PostHtmlUrl | undefined) =>
  data ? data.expiresAt - Date.now() - HTML_URL_REFRESH_MARGIN_MS : 0;

const HEIGHTS = {
  normal: { label: "보통", cls: "h-[min(60vh,600px)]" },
  large: { label: "크게", cls: "h-[min(80vh,900px)]" },
} as const;
type Height = keyof typeof HEIGHTS;

export function PostHtmlFrame({ postId, title, meta }: { postId: string; title: string; meta: PostHtmlMeta }) {
  const [height, setHeight] = useState<Height>("large");
  // Once the frame has loaded, keep its src: swapping in a refreshed URL would reload the page
  // the reader is in. Refreshed URLs are used for "전체 화면으로 열기" and for frames not yet loaded.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);

  const url = useQuery({
    queryKey: queryKeys.postHtmlUrl(postId),
    queryFn: () => api.postHtmlUrl(postId),
    // Fresh until shortly before expiry; then a focus/visit refetches it.
    staleTime: (q) => Math.max(0, remaining(q.state.data)),
    refetchOnWindowFocus: true,
    refetchInterval: (q) => (q.state.data ? Math.max(remaining(q.state.data), 60_000) : false),
    refetchIntervalInBackground: false,
  });

  const src = loadedSrc ?? url.data?.url;

  return (
    <section aria-label="HTML 파일" className="-mx-4 flex flex-col gap-2 lg:mx-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 lg:px-0">
        <span className="rounded bg-accent-subtle px-1.5 py-0.5 text-xs font-semibold text-accent-subtle-text">HTML</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
          {meta.filename} · {formatBytes(meta.size)}
        </span>
        <div role="group" aria-label="높이" className="flex gap-1">
          {(Object.keys(HEIGHTS) as Height[]).map((h) => (
            <button
              key={h}
              type="button"
              aria-pressed={height === h}
              onClick={() => setHeight(h)}
              className={`min-h-9 rounded-md px-2.5 text-[13px] ${
                height === h ? "bg-accent-subtle font-semibold text-accent-subtle-text" : "text-muted hover:text-text"
              }`}
            >
              높이 {HEIGHTS[h].label}
            </button>
          ))}
        </div>
        {url.data && (
          <a
            href={url.data.url}
            target="_blank"
            rel="noopener noreferrer"
            className={btn.secondary}
            onClick={(e) => {
              // An expired link would show the worker's "expired" page; get a new one first.
              if (url.data.expiresAt - Date.now() < 30_000) {
                e.preventDefault();
                void url.refetch().then((r) => {
                  if (r.data) window.open(r.data.url, "_blank", "noopener,noreferrer");
                });
              }
            }}
          >
            전체 화면으로 열기
          </a>
        )}
      </div>

      {url.isPending ? (
        <div role="status" aria-busy="true" aria-label="HTML 불러오는 중" className={HEIGHTS[height].cls}>
          <Skeleton className="h-full w-full rounded-none lg:rounded-lg" />
        </div>
      ) : url.isError && !src ? (
        <div className="px-4 lg:px-0">
          <ErrorState what="HTML 파일을 열지 못했습니다." error={url.error} onRetry={() => void url.refetch()} />
        </div>
      ) : (
        src && (
          <iframe
            src={src}
            title={title}
            sandbox={HTML_FRAME_SANDBOX}
            referrerPolicy="no-referrer"
            loading="lazy"
            onLoad={() => setLoadedSrc(src)}
            className={`block w-full border-y border-border bg-bg lg:rounded-lg lg:border ${HEIGHTS[height].cls}`}
          />
        )
      )}
    </section>
  );
}
