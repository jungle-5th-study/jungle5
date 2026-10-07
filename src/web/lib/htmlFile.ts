// Reading an attached HTML file in the browser (D-30, TD-25). The file is
// decoded as strict UTF-8 (to refuse other encodings before uploading) and
// never executed here; its <title> is read with DOMParser (scripts in a parsed
// document do not run). The upload sends the original bytes, not the text.
import { HTML_EXTENSIONS, LIMITS } from "../../shared/constants";

export interface HtmlFile {
  filename: string;
  html: string;
  /** The file as read: the raw upload body (PUT /api/posts/:id/html). */
  bytes: ArrayBuffer;
  /** UTF-8 bytes */
  size: number;
}

export type HtmlReadResult = { ok: true; file: HtmlFile } | { ok: false; error: string };

/** "980B", "312KB", "1.2MB", "10MB" */
export function formatBytes(n: number): string {
  if (n < 1000) return `${n}B`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}KB`;
  return `${Number((n / 1_000_000).toFixed(1))}MB`;
}

export const HTML_MAX_LABEL = formatBytes(LIMITS.htmlMaxBytes);

export function isHtmlFilename(name: string): boolean {
  const lower = name.toLowerCase();
  return HTML_EXTENSIONS.some((ext) => lower.endsWith(ext) && lower.length > ext.length);
}

async function readBytes(file: Blob): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsArrayBuffer(file);
  });
}

export async function readHtmlFile(file: File): Promise<HtmlReadResult> {
  const filename = file.name.trim();
  if (!isHtmlFilename(filename)) return { ok: false, error: ".html 또는 .htm 파일만 올릴 수 있습니다." };
  if (filename.length > LIMITS.htmlFilenameMax) {
    return { ok: false, error: `파일 이름은 ${LIMITS.htmlFilenameMax}자 이하여야 합니다.` };
  }
  if (file.size > LIMITS.htmlMaxBytes) {
    return {
      ok: false,
      error: `파일이 너무 큽니다 (${formatBytes(file.size)}). ${HTML_MAX_LABEL} 이하만 올릴 수 있습니다.`,
    };
  }
  if (file.size === 0) return { ok: false, error: "빈 파일입니다." };
  let bytes: ArrayBuffer;
  try {
    bytes = await readBytes(file);
  } catch {
    return { ok: false, error: "파일을 읽지 못했습니다. 다시 선택해 주세요." };
  }
  let html: string;
  try {
    html = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return {
      ok: false,
      error: "UTF-8로 저장된 HTML 파일만 올릴 수 있습니다. 편집기에서 인코딩을 UTF-8로 바꿔 다시 저장해 주세요.",
    };
  }
  if (html.includes("\u0000")) return { ok: false, error: "텍스트(HTML) 파일이 아닙니다." };
  return { ok: true, file: { filename, html, bytes, size: bytes.byteLength } };
}

/** Only the head of a (up to 10 MB) file is parsed for its <title>. */
const TITLE_SCAN_CHARS = 64 * 1024;

/** The document's <title>, parsed without running anything; "" when missing. */
export function htmlTitle(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(html.slice(0, TITLE_SCAN_CHARS), "text/html");
    return doc.title.replace(/\s+/g, " ").trim().slice(0, LIMITS.postTitleMax);
  } catch {
    return "";
  }
}

/** "react-hooks.html" → "react-hooks" */
export function titleFromFilename(name: string): string {
  return name.replace(/\.html?$/i, "").trim().slice(0, LIMITS.postTitleMax);
}

/** Title suggestion for a chosen file: its <title>, else the file name. */
export function suggestedTitle(file: Pick<HtmlFile, "filename" | "html">): string {
  return htmlTitle(file.html) || titleFromFilename(file.filename);
}
