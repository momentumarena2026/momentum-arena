import crypto from "crypto";

/**
 * PhonePe Business Static QR — webhook signature verification.
 *
 * Static QR is a separate product from PhonePe Standard Checkout
 * (`lib/phonepe.ts`). It still uses the legacy V1 X-VERIFY scheme:
 * SHA256(merchantId + transactionId + amount + saltKey) signed with
 * a salt key + index pair.
 *
 * Kept isolated from `lib/phonepe.ts` — the new v2 OAuth flow has
 * no salt key, so mixing them in one module would force a
 * "credentials sometimes set, sometimes not" pattern. Two files,
 * two distinct env-var namespaces (PHONEPE_* vs PHONEPE_STATIC_QR_*),
 * keeps each integration self-contained.
 */

const PHONEPE_STATIC_QR_SALT_KEY = process.env.PHONEPE_STATIC_QR_SALT_KEY;
const PHONEPE_STATIC_QR_SALT_INDEX =
  process.env.PHONEPE_STATIC_QR_SALT_INDEX || "1";

/**
 * Verify Static QR callback checksum.
 *
 * V1 algorithm: SHA256(merchantId + transactionId + amount + saltKey)
 * appended with `###<saltIndex>` and compared to the X-VERIFY header
 * PhonePe sends.
 *
 * Returns false if the static-QR credentials aren't configured, so
 * the route can decide whether to accept or reject. (Today we just
 * reject — better than silently accepting unverified webhooks.)
 */
export function verifyStaticQrCallback(
  xVerifyHeader: string,
  merchantId: string,
  transactionId: string,
  amount: number,
): boolean {
  if (!PHONEPE_STATIC_QR_SALT_KEY) return false;

  const data =
    merchantId + transactionId + amount + PHONEPE_STATIC_QR_SALT_KEY;
  const hash = crypto.createHash("sha256").update(data).digest("hex");
  const expected = hash + "###" + PHONEPE_STATIC_QR_SALT_INDEX;

  // Constant-time comparison to avoid leaking the salt one byte at
  // a time via timing.
  const provided = Buffer.from(xVerifyHeader);
  const expectedBuf = Buffer.from(expected);
  if (provided.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(provided, expectedBuf);
}

/** Decoded Static QR callback payload. */
export interface StaticQrCallbackData {
  success: boolean;
  code: string;
  message: string;
  data: {
    transactionId: string;
    merchantId: string;
    providerReferenceId: string;
    amount: number; // in paise
    paymentState: string; // COMPLETED | FAILED
    payResponseCode?: string;
    paymentModes?: Array<{
      mode: string;
      amount: number;
      utr?: string;
    }>;
    transactionContext?: {
      storeId?: string;
      terminalId?: string;
    };
  };
}
