import { afterEach, describe, expect, it, vi } from "vitest";
import { LIMITS } from "../../shared/constants";
import { formatBytes, gzipBytes, HTML_MAX_LABEL, htmlTitle, readHtmlFile, suggestedTitle, titleFromFilename } from "./htmlFile";

afterEach(() => vi.unstubAllGlobals());

const file = (parts: BlobPart[], name = "note.html") => new File(parts, name, { type: "text/html" });

async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new DecompressionStream("gzip");
  const writer = stream.writable.getWriter();
  void writer.write(bytes).then(() => writer.close());
  const reader = stream.readable.getReader();
  const parts: number[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(...value);
  }
  return Uint8Array.from(parts);
}

describe("readHtmlFile (D-30)", () => {
  it("reads a UTF-8 file, reports its byte size and gzips it for the upload", async () => {
    const r = await readHtmlFile(file(["<p>한글</p>"]));
    expect(r).toMatchObject({ ok: true, file: { filename: "note.html", html: "<p>한글</p>", size: 13 } });
    if (!r.ok) throw new Error("not ok");
    // The body is a gzip of the original bytes (magic 1f 8b 08), and its size is reported.
    expect(Array.from(r.file.body.subarray(0, 3))).toEqual([0x1f, 0x8b, 0x08]);
    expect(r.file.compressedSize).toBe(r.file.body.byteLength);
    expect(new TextDecoder().decode(await gunzip(r.file.body))).toBe("<p>한글</p>");
  });

  it("gzipBytes: single member whose trailer is the original size", async () => {
    const original = new TextEncoder().encode("<p>정글</p>".repeat(10_000));
    const gz = await gzipBytes(original);
    expect(gz.byteLength).toBeLessThan(original.byteLength / 10);
    expect(new DataView(gz.buffer).getUint32(gz.byteLength - 4, true)).toBe(original.byteLength);
    expect(new TextDecoder().decode(await gunzip(gz))).toBe(new TextDecoder().decode(original));
  });

  it("rejects a file that is not valid UTF-8 (fatal decoding)", async () => {
    // "한글" in EUC-KR
    const r = await readHtmlFile(file([new Uint8Array([0x3c, 0x70, 0x3e, 0xc7, 0xd1, 0xb1, 0xdb])]));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/UTF-8로 저장된 HTML 파일만/);
  });

  it("limits: 50 MB original (checked before reading), 10 MB compressed", async () => {
    expect(LIMITS.htmlMaxOriginalBytes).toBe(50_000_000);
    expect(LIMITS.htmlMaxStoredBytes).toBe(10_000_000);
    expect(HTML_MAX_LABEL).toBe("원본 50MB, 압축 후 10MB 이하");
    const big = file([new Uint8Array(61_234_567)]);
    expect(await readHtmlFile(big)).toEqual({
      ok: false,
      error: "파일이 너무 큽니다 (61.2MB). 원본 50MB, 압축 후 10MB 이하만 올릴 수 있습니다.",
    });
    expect((await readHtmlFile(file([new Uint8Array(LIMITS.htmlMaxOriginalBytes + 1)]))).ok).toBe(false);
    // 12 MB of text compresses far below 10 MB: accepted.
    const ok = await readHtmlFile(file(["a".repeat(12_000_000)]));
    expect(ok.ok).toBe(true);
    expect(ok.ok && ok.file.size).toBe(12_000_000);
    expect(ok.ok && ok.file.compressedSize).toBeLessThan(1_000_000);
  });

  it("a file that is still over 10 MB after compression → both sizes in the message", async () => {
    const compressed = new Uint8Array(LIMITS.htmlMaxStoredBytes + 1_234_567);
    class FakeCompressionStream {
      readonly writable: WritableStream<Uint8Array>;
      readonly readable: ReadableStream<Uint8Array>;
      constructor() {
        const t = new TransformStream<Uint8Array, Uint8Array>({ transform: () => undefined, flush: (c) => c.enqueue(compressed) });
        this.writable = t.writable;
        this.readable = t.readable;
      }
    }
    vi.stubGlobal("CompressionStream", FakeCompressionStream);
    const r = await readHtmlFile(file(["<p>x</p>".repeat(5_000_000)]));
    expect(r).toEqual({
      ok: false,
      error: "압축해도 너무 큽니다 (원본 40MB → 압축 11.2MB). 원본 50MB, 압축 후 10MB 이하만 올릴 수 있습니다.",
    });
  });

  it("without CompressionStream: the raw file up to 10 MB, a clear message above", async () => {
    vi.stubGlobal("CompressionStream", undefined);
    const small = await readHtmlFile(file(["<p>한글</p>"]));
    expect(small).toMatchObject({ ok: true, file: { size: 13, compressedSize: null } });
    expect(small.ok && new TextDecoder().decode(small.file.body)).toBe("<p>한글</p>");
    expect((await readHtmlFile(file(["a".repeat(LIMITS.htmlMaxStoredBytes)]))).ok).toBe(true);
    expect(await readHtmlFile(file(["a".repeat(LIMITS.htmlMaxStoredBytes + 1)]))).toEqual({
      ok: false,
      error: "이 브라우저에서는 10MB가 넘는 파일을 올릴 수 없습니다 (10MB). 최신 브라우저에서 다시 올려 주세요.",
    });
  });

  it("rejects other extensions, empty files and NUL bytes", async () => {
    expect((await readHtmlFile(file(["x"], "note.txt"))).ok).toBe(false);
    expect((await readHtmlFile(file([""], "a.htm"))).ok).toBe(false);
    expect((await readHtmlFile(file(["a\u0000b"], "a.HTML"))).ok).toBe(false);
  });
});

describe("title suggestion", () => {
  it("uses <title> without running scripts", () => {
    const w = window as unknown as { hacked?: boolean };
    const html = "<html><head><title>  React 훅\n정리 </title><script>window.hacked = true</script></head></html>";
    expect(htmlTitle(html)).toBe("React 훅 정리");
    expect(w.hacked).toBeUndefined();
  });

  it("falls back to the file name without its extension", () => {
    expect(htmlTitle("<p>no title</p>")).toBe("");
    expect(titleFromFilename("react-hooks.HTML")).toBe("react-hooks");
    expect(suggestedTitle({ filename: "deep-dive.htm", html: "<p>x</p>" })).toBe("deep-dive");
  });

  it("formats sizes", () => {
    expect(formatBytes(999)).toBe("999B");
    expect(formatBytes(312_400)).toBe("312KB");
    expect(formatBytes(1_500_000)).toBe("1.5MB");
    expect(formatBytes(10_000_000)).toBe("10MB");
  });
});
