// Reading an attached HTML file in the browser (D-30, TD-25). The file is
// decoded as strict UTF-8 (to refuse other encodings before uploading) and
// never executed here; its <title> is read with DOMParser (scripts in a parsed
// document do not run). The upload sends the original bytes gzip-compressed
// (CompressionStream): up to 50 MB original, 10 MB compressed. The server
// cannot check UTF-8 inside the gzip (it never decompresses), so this check
// is the only one for gzip uploads.
import { HTML_EXTENSIONS, LIMITS } from "../../shared/constants";
import { HTML_LIMITS_LABEL } from "../../shared/schemas";

export interface HtmlFile {
  filename: string;
  html: string;
  /** Original UTF-8 bytes */
  size: number;
  /**
   * The upload body (PUT /api/posts/:id/html): the gzip bytes, or the raw
   * file when this browser has no CompressionStream (then ≤ 10 MB).
   */
  body: Uint8Array<ArrayBuffer>;
  /** Size of the gzip body; null when the body is the raw file. */
  compressedSize: number | null;
}

export type HtmlReadResult = { ok: true; file: HtmlFile } | { ok: false; error: string };

/** "980B", "312KB", "1.2MB", "10MB" */
export function formatBytes(n: number): string {
  if (n < 1000) return `${n}B`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}KB`;
  return `${Number((n / 1_000_000).toFixed(1))}MB`;
}

/** "원본 50MB, 압축 후 10MB 이하" */
export const HTML_MAX_LABEL = HTML_LIMITS_LABEL;

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

/** True when this browser can gzip (CompressionStream: all current browsers). */
export function canGzip(): boolean {
  return typeof CompressionStream === "function";
}

/** gzip with CompressionStream (single member; its trailer holds the original size, which the server checks). */
export async function gzipBytes(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new CompressionStream("gzip");
  const writer = stream.writable.getWriter();
  // Write and read concurrently: awaiting the write first would wait on backpressure forever.
  const written = writer.write(bytes).then(() => writer.close());
  const reader = stream.readable.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    total += value.byteLength;
  }
  await written;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

export async function readHtmlFile(file: File): Promise<HtmlReadResult> {
  const filename = file.name.trim();
  if (!isHtmlFilename(filename)) return { ok: false, error: ".html 또는 .htm 파일만 올릴 수 있습니다." };
  if (filename.length > LIMITS.htmlFilenameMax) {
    return { ok: false, error: `파일 이름은 ${LIMITS.htmlFilenameMax}자 이하여야 합니다.` };
  }
  if (file.size > LIMITS.htmlMaxOriginalBytes) {
    return {
      ok: false,
      error: `파일이 너무 큽니다 (${formatBytes(file.size)}). ${HTML_MAX_LABEL}만 올릴 수 있습니다.`,
    };
  }
  if (file.size === 0) return { ok: false, error: "빈 파일입니다." };
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(await readBytes(file));
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
  const size = bytes.byteLength;

  if (!canGzip()) {
    // Old browser: the raw upload, which the server takes up to 10 MB.
    if (size > LIMITS.htmlMaxStoredBytes) {
      return {
        ok: false,
        error: `이 브라우저에서는 ${formatBytes(LIMITS.htmlMaxStoredBytes)}가 넘는 파일을 올릴 수 없습니다 (${formatBytes(size)}). 최신 브라우저에서 다시 올려 주세요.`,
      };
    }
    return { ok: true, file: { filename, html, size, body: bytes, compressedSize: null } };
  }
  let gz: Uint8Array<ArrayBuffer>;
  try {
    gz = await gzipBytes(bytes);
  } catch {
    return { ok: false, error: "파일을 압축하지 못했습니다. 다시 선택해 주세요." };
  }
  if (gz.byteLength > LIMITS.htmlMaxStoredBytes) {
    return {
      ok: false,
      error: `압축해도 너무 큽니다 (원본 ${formatBytes(size)} → 압축 ${formatBytes(gz.byteLength)}). ${HTML_MAX_LABEL}만 올릴 수 있습니다.`,
    };
  }
  return { ok: true, file: { filename, html, size, body: gz, compressedSize: gz.byteLength } };
}

/** Only the head of a (up to 50 MB) file is parsed for its <title>. */
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
