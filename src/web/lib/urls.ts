// URL allow-lists for user content (TSD C-09, TD-18).
export function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Allowed href: absolute http(s) or an in-page fragment. Everything else is dropped. */
export function safeHref(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith("#")) return trimmed;
  const url = parseUrl(trimmed);
  return url && (url.protocol === "http:" || url.protocol === "https:") ? url.href : null;
}

/** Allowed image src: absolute https only (TD-18). */
export function safeImageSrc(value: string): string | null {
  const url = parseUrl(value.trim());
  return url && url.protocol === "https:" ? url.href : null;
}
