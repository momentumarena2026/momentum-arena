import crypto from "crypto";

// Field-level encryption for sensitive HR data (currently: employee Aadhaar).
//
// AES-256-GCM (authenticated). The 256-bit key is derived (HKDF-SHA256) from an
// existing stable server secret — AUTH_SECRET — so NO new env var is required
// to run the feature. An explicit HR_ENCRYPTION_KEY (64 hex chars = 32 bytes)
// overrides the derivation if you ever want a dedicated, independently-rotated
// key. Ciphertext is stored as "v1:<iv-b64>:<tag-b64>:<data-b64>" so the scheme
// is self-describing and future key/version migrations are possible.
//
// NOTE: the key is derived from AUTH_SECRET; rotating AUTH_SECRET would make
// existing encrypted Aadhaar values undecryptable. If AUTH_SECRET is ever
// rotated, set HR_ENCRYPTION_KEY first (pinned to the old derived value) or
// plan to re-capture Aadhaar.

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const explicit = process.env.HR_ENCRYPTION_KEY;
  if (explicit && /^[0-9a-fA-F]{64}$/.test(explicit)) {
    cachedKey = Buffer.from(explicit, "hex");
    return cachedKey;
  }

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "HR encryption key unavailable: set AUTH_SECRET (or HR_ENCRYPTION_KEY)"
    );
  }
  // HKDF binds the derived key to this specific purpose via salt + info.
  const derived = crypto.hkdfSync(
    "sha256",
    secret,
    "momentum-hr-salt",
    "hr-aadhaar-v1",
    32
  );
  cachedKey = Buffer.from(derived);
  return cachedKey;
}

export function encryptAadhaar(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptAadhaar(ciphertext: string): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Unsupported or malformed ciphertext");
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getKey(),
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}
