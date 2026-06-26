import crypto, { type BinaryLike, type BinaryToTextEncoding } from "crypto";

// Hashing + RSA code-signing primitives for the self-hosted Expo Updates
// server. Ported verbatim from Expo's official `custom-expo-updates-server`
// so the byte-level behaviour matches what the embedded client verifies.
//
// Two hashes per asset, do NOT conflate them:
//   - `hash` = base64url(SHA-256(bytes))  → integrity check on the client
//   - `key`  = hex(MD5(bytes))            → stable per-asset identifier

export function createHash(
  data: BinaryLike,
  algorithm: string,
  encoding: BinaryToTextEncoding,
): string {
  return crypto.createHash(algorithm).update(data).digest(encoding);
}

/** Standard base64 → base64url (RFC 4648 §5). */
export function toBase64URL(base64: string): string {
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url SHA-256 of the bytes — the manifest asset `hash`. */
export function assetHash(data: BinaryLike): string {
  return toBase64URL(createHash(data, "sha256", "base64"));
}

/** hex MD5 of the bytes — the manifest asset `key`. */
export function assetKey(data: BinaryLike): string {
  return createHash(data, "md5", "hex");
}

/** Format a 32-char SHA-256 hex slice as a UUID (Expo manifest id helper). */
export function sha256HexToUUID(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// Must match the app's `codeSigningMetadata` (expo-updates codesigning:configure
// writes keyid "main", alg "rsa-v1_5-sha256" into app.json + Expo.plist).
const KEY_ID = "main";
const ALG = "rsa-v1_5-sha256";

function privateKeyPem(): string | null {
  const raw = process.env.EXPO_OTA_PRIVATE_KEY;
  if (!raw) return null;
  // Vercel env stores the PEM with literal "\n"; restore real newlines.
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

/** Code signing is active only when the private key env var is present. */
export function isCodeSigningConfigured(): boolean {
  return !!privateKeyPem();
}

/**
 * RSA-SHA256 (RSASSA-PKCS1-v1_5) sign a UTF-8 string body, returning a
 * standard base64 signature (NOT base64url). The signed bytes MUST be the
 * exact string written into the multipart part body, or client verification
 * fails on whitespace/key-order differences.
 */
export function signRSASHA256(body: string): string {
  const key = privateKeyPem();
  if (!key) throw new Error("EXPO_OTA_PRIVATE_KEY is not configured");
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(body, "utf8");
  sign.end();
  return sign.sign(key, "base64");
}

/**
 * Build the `expo-signature` structured-field-value header for a signed part.
 * A base64 signature only contains [A-Za-z0-9+/=], so quoting is safe without
 * a full SFV serializer.
 */
export function buildSignatureHeader(body: string): string {
  return `sig="${signRSASHA256(body)}", keyid="${KEY_ID}", alg="${ALG}"`;
}
