import { lazy, Suspense } from "react";

// The Markdown pipeline is the largest dependency; load it with the first
// screen that renders Markdown instead of on every page.
const load = () => import("./MarkdownRenderer");
const MarkdownRenderer = lazy(load);

/** Warm the chunk in the background so post pages render without a fallback flash. */
export function preloadMarkdown(): void {
  void load().catch(() => undefined);
}

export function Markdown({ source }: { source: string }) {
  return (
    <Suspense
      fallback={
        <div aria-busy="true" className="markdown text-muted">
          <p className="whitespace-pre-wrap">{source.slice(0, 2000)}</p>
        </div>
      }
    >
      <MarkdownRenderer source={source} />
    </Suspense>
  );
}
