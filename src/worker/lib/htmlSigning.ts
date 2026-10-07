// Signed URLs for the isolated HTML worker (TD-26). The main worker signs,
// `jungle5-html` verifies; both hold the same HTML_SIGNING_KEY secret.
// Message: `${postId}.${exp}` (exp = unix seconds). Signature: HMAC-SHA256, hex.
// Keep this module dependency-free: it is bundled into the HTML worker too.

const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error("HTML_SIGNING_KEY must be set (at least 32 characters)");
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
      "verify",
    ]);
    keyCache.set(secret, key);
  }
  return key;
}

const message = (postId: string, exp: number) => new TextEncoder().encode(`${postId}.${exp}`);

export async function signHtmlUrl(secret: string, postId: string, exp: number): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), message(postId, exp));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Builds `${origin}/v/${postId}?exp=…&sig=…`. */
export async function buildHtmlUrl(origin: string, secret: string, postId: string, exp: number): Promise<string> {
  const sig = await signHtmlUrl(secret, postId, exp);
  return `${origin.replace(/\/+$/, "")}/v/${encodeURIComponent(postId)}?exp=${exp}&sig=${sig}`;
}

/** Constant-time check (WebCrypto HMAC verify). Malformed input → false. */
export async function verifyHtmlSignature(secret: string, postId: string, exp: number, sigHex: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/i.test(sigHex)) return false;
  const sig = new Uint8Array(32);
  for (let i = 0; i < 32; i++) sig[i] = parseInt(sigHex.slice(i * 2, i * 2 + 2), 16);
  return crypto.subtle.verify("HMAC", await hmacKey(secret), sig, message(postId, exp));
}
