// Client-side Markdown (TSD TD-12, TD-18, C-09). Raw HTML is never rendered;
// the hast tree is sanitized with an allow-list; links are http/https only
// (plus in-page #fragments); images are https only.
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { parseUrl, safeHref, safeImageSrc } from "../lib/urls";

const schema: SanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https"],
    src: ["https"],
    cite: ["http", "https"],
  },
};

function urlTransform(url: string, key: string): string | null {
  if (key === "src") return safeImageSrc(url);
  if (key === "href" || key === "cite") return safeHref(url);
  return null;
}

function isExternal(href: string): boolean {
  if (href.startsWith("#")) return false;
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return parseUrl(href)?.origin !== origin;
}

const components: Components = {
  a({ node: _node, href, children, ...rest }) {
    const safe = typeof href === "string" ? safeHref(href) : null;
    if (!safe) return <span>{children}</span>;
    if (!isExternal(safe)) {
      return (
        <a {...rest} href={safe}>
          {children}
        </a>
      );
    }
    return (
      <a {...rest} href={safe} target="_blank" rel="noopener noreferrer nofollow">
        {children}
      </a>
    );
  },
  img({ node: _node, src, alt }) {
    const safe = typeof src === "string" ? safeImageSrc(src) : null;
    if (!safe) return alt ? <span className="text-muted">[이미지: {alt}]</span> : null;
    return <img src={safe} alt={alt ?? ""} referrerPolicy="no-referrer" loading="lazy" decoding="async" />;
  },
};

export default function MarkdownRenderer({ source }: { source: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, schema]]}
        skipHtml
        urlTransform={urlTransform}
        components={components}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
