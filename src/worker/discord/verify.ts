// Discord interaction request signatures (TD-27): Ed25519 over
// `X-Signature-Timestamp + raw body`, checked with the application's public key.

const keyCache = new Map<string, Promise<CryptoKey>>();

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function publicKey(hex: string): Promise<CryptoKey> {
  let key = keyCache.get(hex);
  if (!key) {
    const raw = hexToBytes(hex);
    if (!raw || raw.length !== 32) return Promise.reject(new Error("DISCORD_PUBLIC_KEY must be 32 bytes hex"));
    key = crypto.subtle.importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]);
    keyCache.set(hex, key);
  }
  return key;
}

/** false for any missing/malformed input, an unset key, or a bad signature. */
export async function verifyDiscordSignature(
  publicKeyHex: string,
  signatureHex: string | undefined,
  timestamp: string | undefined,
  rawBody: string,
): Promise<boolean> {
  if (!publicKeyHex || !signatureHex || !timestamp) return false;
  const sig = hexToBytes(signatureHex);
  if (!sig || sig.length !== 64) return false;
  try {
    const key = await publicKey(publicKeyHex);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, sig, new TextEncoder().encode(timestamp + rawBody));
  } catch {
    return false;
  }
}
