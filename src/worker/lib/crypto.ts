// WebCrypto helpers: session tokens (TSD 6.1) and Discord token encryption (6.3).

export function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 32 random bytes, base64url. */
export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function importKey(b64Key: string): Promise<CryptoKey> {
  let key = keyCache.get(b64Key);
  if (!key) {
    const raw = base64ToBytes(b64Key);
    if (raw.length !== 32) throw new Error("TOKEN_ENC_KEY must be 32 bytes (base64)");
    key = crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
    keyCache.set(b64Key, key);
  }
  return key;
}

/** AES-256-GCM with a fresh 96-bit IV. Output: `v1.<iv b64>.<ciphertext b64>`. */
export async function encryptSecret(plaintext: string, b64Key: string): Promise<string> {
  const key = await importKey(b64Key);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return `v1.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(ct))}`;
}

export async function decryptSecret(payload: string, b64Key: string): Promise<string> {
  const [version, ivB64, ctB64] = payload.split(".");
  if (version !== "v1" || !ivB64 || !ctB64) throw new Error("unsupported ciphertext format");
  const key = await importKey(b64Key);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(ivB64) }, key, base64ToBytes(ctB64));
  return new TextDecoder().decode(pt);
}
