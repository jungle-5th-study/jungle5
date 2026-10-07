import { describe, expect, it } from "vitest";
import { LIMITS } from "../../shared/constants";
import { formatBytes, htmlTitle, readHtmlFile, suggestedTitle, titleFromFilename } from "./htmlFile";

const file = (parts: BlobPart[], name = "note.html") => new File(parts, name, { type: "text/html" });

describe("readHtmlFile (D-30)", () => {
  it("reads a UTF-8 file and reports its byte size", async () => {
    const r = await readHtmlFile(file(["<p>한글</p>"]));
    expect(r).toMatchObject({ ok: true, file: { filename: "note.html", html: "<p>한글</p>", size: 13 } });
    // The original bytes are kept for the raw upload.
    expect(r.ok && new TextDecoder().decode(new Uint8Array(r.file.bytes))).toBe("<p>한글</p>");
  });

  it("rejects a file that is not valid UTF-8 (fatal decoding)", async () => {
    // "한글" in EUC-KR
    const r = await readHtmlFile(file([new Uint8Array([0x3c, 0x70, 0x3e, 0xc7, 0xd1, 0xb1, 0xdb])]));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/UTF-8로 저장된 HTML 파일만/);
  });

  it("rejects files over the size limit before reading, showing the size", async () => {
    expect(LIMITS.htmlMaxBytes).toBe(10_000_000);
    const big = file([new Uint8Array(12_345_678)]);
    expect(await readHtmlFile(big)).toEqual({ ok: false, error: "파일이 너무 큽니다 (12.3MB). 10MB 이하만 올릴 수 있습니다." });
    expect((await readHtmlFile(file([new Uint8Array(LIMITS.htmlMaxBytes + 1)]))).ok).toBe(false);
    const ok = await readHtmlFile(file(["a".repeat(LIMITS.htmlMaxBytes)]));
    expect(ok.ok).toBe(true);
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
