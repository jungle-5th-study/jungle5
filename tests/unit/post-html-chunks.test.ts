// Splitting an attached HTML file into D1-sized pieces (TD-25): cuts only at
// UTF-8 character boundaries, and decoding the pieces gives back the file.
import { describe, expect, it } from "vitest";
import { LIMITS } from "../../src/shared/constants";
import { decodeHtmlBytes, HTML_CHUNK_BYTES, splitUtf8 } from "../../src/worker/lib/postHtml";

const enc = new TextEncoder();
const C = HTML_CHUNK_BYTES;

/** `prefix` ASCII bytes, then `ch`, then ASCII up to `total` bytes. */
function withCharAt(prefix: number, ch: string, total: number): Uint8Array {
  const chBytes = enc.encode(ch);
  const out = new Uint8Array(total).fill(0x61);
  out.set(chBytes, prefix);
  return out;
}

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

/** Byte equality without a per-element deep-equal diff (pieces are megabytes). */
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

const isContinuation = (b: number | undefined) => b !== undefined && (b & 0xc0) === 0x80;

describe("splitUtf8", () => {
  it("is exactly 1.9 MB pieces for ASCII, one piece up to the limit", () => {
    expect(C).toBe(1_900_000);
    expect(splitUtf8(new Uint8Array(C)).map((p) => p.length)).toEqual([C]);
    expect(splitUtf8(new Uint8Array(C + 1)).map((p) => p.length)).toEqual([C, 1]);
    expect(splitUtf8(new Uint8Array(2 * C)).map((p) => p.length)).toEqual([C, C]);
    expect(splitUtf8(new Uint8Array(0)).map((p) => p.length)).toEqual([0]);
  });

  // Every position of a 3-byte Hangul and a 4-byte emoji around the cut.
  for (const [label, ch] of [
    ["3-byte Hangul", "한"],
    ["4-byte emoji", "😀"],
  ] as const) {
    it(`never cuts inside a ${label} straddling the 1.9 MB cut`, () => {
      const width = enc.encode(ch).length;
      for (let prefix = C - width; prefix <= C; prefix++) {
        const bytes = withCharAt(prefix, ch, C + 10);
        const pieces = splitUtf8(bytes);
        const first = pieces[0]!;
        // Cut either after the whole character or right before it.
        const straddles = prefix < C && prefix + width > C;
        expect(first.length, `prefix ${prefix}`).toBe(straddles ? prefix : C);
        for (const p of pieces) {
          expect(p.length).toBeLessThanOrEqual(C);
          expect(isContinuation(p[0]), `prefix ${prefix}`).toBe(false);
        }
        expect(sameBytes(concat(pieces), bytes)).toBe(true);
        const decoded = pieces.map((p) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(p));
        expect(decoded.join("")).toBe(new TextDecoder().decode(bytes));
        expect(decoded.join("")).toContain(ch);
      }
    });
  }

  it("dense multi-byte text up to 10,000,000 bytes: every piece starts on a character and decodes", () => {
    const unit = enc.encode("가😀나a"); // 11 bytes: cuts at multiples of 1.9 MB fall inside characters
    const n = Math.floor(LIMITS.htmlMaxBytes / unit.length) * unit.length;
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i += unit.length) bytes.set(unit, i);
    const pieces = splitUtf8(bytes);
    expect(pieces.length).toBe(6);
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    for (const p of pieces) {
      expect(p.length).toBeLessThanOrEqual(C);
      if (p !== pieces.at(-1)) expect(p.length).toBeGreaterThanOrEqual(C - 3);
      expect(isContinuation(p[0])).toBe(false);
      decoder.decode(p);
    }
    expect(pieces.reduce((s, p) => s + p.length, 0)).toBe(n);
  });

  it("invalid UTF-8 (a run of continuation bytes) backs up at most 3 bytes and then cuts", () => {
    const bytes = new Uint8Array(C + 10).fill(0x80);
    const pieces = splitUtf8(bytes);
    expect(pieces[0]!.length).toBe(C - 3);
    expect(decodeHtmlBytes(bytes)).toEqual({ ok: false, problem: "not_text" });
  });
});

describe("decodeHtmlBytes", () => {
  it("keeps a BOM and U+FEFF at a cut, so the pieces re-encode to the exact bytes", () => {
    const bytes = withCharAt(C, "﻿", C + 10);
    bytes.set([0xef, 0xbb, 0xbf], 0);
    const r = decodeHtmlBytes(bytes);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.size).toBe(C + 10);
    expect(r.pieces).toHaveLength(2);
    expect(r.pieces[0]!.startsWith("﻿")).toBe(true);
    expect(r.pieces[1]!.startsWith("﻿")).toBe(true);
    expect(sameBytes(concat(r.pieces.map((p) => enc.encode(p))), bytes)).toBe(true);
  });

  it("refuses empty, oversize, NUL and non-UTF-8 input", () => {
    expect(decodeHtmlBytes(new Uint8Array(0))).toEqual({ ok: false, problem: "empty" });
    expect(decodeHtmlBytes(new Uint8Array(LIMITS.htmlMaxBytes + 1).fill(0x61))).toEqual({ ok: false, problem: "too_large" });
    expect(decodeHtmlBytes(enc.encode("<p>a\u0000b</p>"))).toEqual({ ok: false, problem: "not_text" });
    // NUL far into a later piece.
    const late = new Uint8Array(C + 100).fill(0x61);
    late[C + 50] = 0;
    expect(decodeHtmlBytes(late)).toEqual({ ok: false, problem: "not_text" });
    expect(decodeHtmlBytes(new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb]))).toEqual({ ok: false, problem: "not_text" });
    // A truncated character at the very end.
    expect(decodeHtmlBytes(enc.encode("한").subarray(0, 2))).toEqual({ ok: false, problem: "not_text" });
    expect(decodeHtmlBytes(new Uint8Array(LIMITS.htmlMaxBytes).fill(0x61))).toMatchObject({ ok: true, size: LIMITS.htmlMaxBytes });
  });
});
