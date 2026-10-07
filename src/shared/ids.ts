// UUIDv7 (RFC 9562). Used by the server for its own rows and by the SPA for
// client-generated create IDs (TSD TD-13).
export function uuidv7(now: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let ts = now;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ts % 256;
    ts = Math.floor(ts / 256);
  }
  bytes[6] = 0x70 | (bytes[6]! & 0x0f);
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Normalized key for duplicate detection of categories and tags (D-17):
 * Unicode NFC, lower-cased, all whitespace removed.
 */
export function nameKey(name: string): string {
  return name.normalize("NFC").toLowerCase().replace(/\s+/gu, "");
}
