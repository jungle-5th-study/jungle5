// Hex <-> bytes for BLOB values (TD-25, migration 0005). D1 returns a BLOB as
// an Array of numbers (one JS number per byte, slow and large), so gzip pieces
// are written as `unhex(?)` with a hex string and read back as `hex(data)`.
// Uint8Array#toHex / Uint8Array.fromHex are native in workerd (about 1 ms per
// 950 KB, measured); the loops are a fallback for runtimes without them.

type HexNative = {
  fromHex?: (hex: string) => Uint8Array;
};
type HexBytes = Uint8Array & { toHex?: () => string };

const DIGITS = "0123456789abcdef";

export function bytesToHex(bytes: Uint8Array): string {
  const native = (bytes as HexBytes).toHex;
  if (typeof native === "function") return native.call(bytes);
  let out = "";
  for (const b of bytes) out += DIGITS[b >> 4]! + DIGITS[b & 15]!;
  return out;
}

/** Accepts upper or lower case (SQLite's hex() is upper case). Throws on malformed input. */
export function hexToBytes(hex: string): Uint8Array {
  const native = (Uint8Array as unknown as HexNative).fromHex;
  if (typeof native === "function") return native(hex);
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) throw new SyntaxError("invalid hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}
