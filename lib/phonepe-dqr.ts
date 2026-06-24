import crypto from "crypto";
import QRCode from "qrcode";

/**
 * PhonePe Dynamic QR (DQR) — the offline/enterprise "generate a
 * per-transaction QR" product. It is the dynamic sibling of the
 * static-QR product in `lib/phonepe-static-qr.ts` and shares its
 * legacy V1 X-VERIFY signing scheme (SHA256(payload + apiPath +
 * saltKey) + "###" + saltIndex) — NOT the OAuth v2 scheme in
 * `lib/phonepe.ts`.
 *
 * Why a third PhonePe module: DQR has its own host (`mercury-*`), its
 * own merchant id + salt, and its own store/terminal concept. Keeping
 * it isolated mirrors the existing split and avoids a "credentials
 * sometimes set" tangle.
 *
 * Flow: `qrInit()` returns a `qrString` (`upi://pay?...` with the
 * amount embedded) that the client renders as a QR / opens as a deep
 * link. Payment confirmation arrives two ways — an S2S callback to
 * X-CALLBACK-URL (authoritative) and `qrStatus()` polling (UX backup).
 *
 * Dormant until configured: `isDqrConfigured()` gates the whole
 * feature so nothing runs until PhonePe onboarding lands the creds.
 *
 * ⚠️ The exact request-body wrapping and the status/callback checksum
 * strings should be re-confirmed against the PhonePe DQR sandbox at
 * activation time; the values here follow the DQR Init API doc and the
 * enterprise V1 conventions.
 */

const PHONEPE_ENV = process.env.PHONEPE_ENV || "SANDBOX"; // "SANDBOX" | "PRODUCTION"
const isProd = PHONEPE_ENV === "PRODUCTION";

const DQR_MERCHANT_ID = process.env.PHONEPE_DQR_MERCHANT_ID;
const DQR_SALT_KEY = process.env.PHONEPE_DQR_SALT_KEY;
const DQR_SALT_INDEX = process.env.PHONEPE_DQR_SALT_INDEX || "1";
const DQR_STORE_ID = process.env.PHONEPE_DQR_STORE_ID;
const DQR_TERMINAL_ID = process.env.PHONEPE_DQR_TERMINAL_ID;

// Mercury host. The UAT host carries an `/enterprise-sandbox` prefix
// that production drops. IMPORTANT: that prefix is part of the request
// URL only — the X-VERIFY checksum signs the *logical* API path
// (`/v3/qr/init`, `/v3/transaction/.../status`) on BOTH environments,
// exactly as the DQR docs show. Signing the prefixed UAT pathname would
// fail auth on sandbox (matches the PG v1 sandbox convention).
const DQR_BASE = isProd
  ? "https://mercury-t2.phonepe.com"
  : "https://mercury-uat.phonepe.com/enterprise-sandbox";

// Logical API paths — used verbatim in the X-VERIFY checksum and
// appended to DQR_BASE for the actual request URL.
const QR_INIT_PATH = "/v3/qr/init";
const txnStatusPath = (merchantId: string, transactionId: string) =>
  `/v3/transaction/${encodeURIComponent(merchantId)}/${encodeURIComponent(
    transactionId,
  )}/status`;

export const DQR_CONFIRMED_BY = "PHONEPE_DQR";

/**
 * True when the DQR product is fully provisioned in env. Callers MUST
 * gate on this before any qrInit/qrStatus call — when false, the app
 * falls back to the legacy static-QR flow.
 */
export function isDqrConfigured(): boolean {
  return Boolean(DQR_MERCHANT_ID && DQR_SALT_KEY && DQR_STORE_ID);
}

/** The merchant id, or throw a clear error if DQR isn't configured. */
function requireMerchantId(): string {
  if (!isDqrConfigured() || !DQR_MERCHANT_ID) {
    throw new Error(
      "PhonePe DQR not configured — set PHONEPE_DQR_MERCHANT_ID, PHONEPE_DQR_SALT_KEY, PHONEPE_DQR_STORE_ID",
    );
  }
  return DQR_MERCHANT_ID;
}

/**
 * V1 X-VERIFY: SHA256(stringToSign + saltKey) + "###" + saltIndex.
 * `stringToSign` is `base64Payload + apiPath` for POSTs and `apiPath`
 * for GETs (per PhonePe's enterprise signing convention).
 */
function xVerify(stringToSign: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(stringToSign + DQR_SALT_KEY)
    .digest("hex");
  return `${hash}###${DQR_SALT_INDEX}`;
}

export interface QrInitParams {
  /** Our unique id (< 35 chars, alnum/_/-). Stored as phonePeMerchantTxnId. */
  transactionId: string;
  /** Amount in paise (matches our PhonePe/Razorpay convention). */
  amountPaise: number;
  /** QR validity in seconds. Tie to the hold TTL. */
  expiresIn: number;
  /** Absolute URL PhonePe POSTs the result to (our dqr-callback). */
  callbackUrl: string;
  /** Customer-facing line on the UPI app (cosmetic). */
  message?: string;
}

export interface QrInitResult {
  /** `upi://pay?...` URI — render as a QR and/or open as a deep link. */
  qrString: string;
  /** PNG data URL of the QR, rendered server-side so web AND React
   *  Native clients can show it via a plain <img>/<Image> with no
   *  client-side QR dependency. */
  qrImage: string;
  transactionId: string;
}

/**
 * Generate a dynamic QR for one transaction. Throws on misconfig or a
 * non-2xx / unsuccessful PhonePe response (callers surface a friendly
 * error and can fall back to legacy static QR).
 */
export async function qrInit(params: QrInitParams): Promise<QrInitResult> {
  const merchantId = requireMerchantId();

  const payload = {
    merchantId,
    transactionId: params.transactionId,
    merchantOrderId: params.transactionId,
    amount: params.amountPaise,
    expiresIn: params.expiresIn,
    storeId: DQR_STORE_ID,
    ...(DQR_TERMINAL_ID ? { terminalId: DQR_TERMINAL_ID } : {}),
    ...(params.message ? { message: params.message } : {}),
  };

  const base64 = Buffer.from(JSON.stringify(payload)).toString("base64");
  const endpoint = `${DQR_BASE}${QR_INIT_PATH}`;
  // Sign the logical path (no /enterprise-sandbox prefix), per the docs.
  const checksum = xVerify(base64 + QR_INIT_PATH);

  const res = await fetch(endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(10000),
    headers: {
      "Content-Type": "application/json",
      "X-VERIFY": checksum,
      "X-CALL-MODE": "POST",
      "X-CALLBACK-URL": params.callbackUrl,
    },
    // Enterprise V1/V3 wrap the base64 payload in `{ request }`.
    body: JSON.stringify({ request: base64 }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PhonePe DQR init failed: ${res.status} ${text.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    success?: boolean;
    code?: string;
    data?: { qrString?: string; transactionId?: string };
  };

  const qrString = data.data?.qrString;
  if (!data.success || !qrString) {
    throw new Error(
      `PhonePe DQR init unsuccessful: code=${data.code ?? "?"} success=${data.success}`,
    );
  }

  // Render the QR server-side so every client (web + React Native) can
  // display it without a client-side QR library.
  const qrImage = await QRCode.toDataURL(qrString, { width: 320, margin: 1 });

  return { qrString, qrImage, transactionId: params.transactionId };
}

export type DqrState = "PENDING" | "COMPLETED" | "FAILED";

export interface QrStatusResult {
  success: boolean;
  state: DqrState;
  /** PhonePe-side reference / provider txn id, when present. */
  providerReferenceId?: string;
  /** Amount in paise, when present. */
  amount?: number;
}

/** Server-side status poll for a DQR transaction. */
export async function qrStatus(transactionId: string): Promise<QrStatusResult> {
  const merchantId = requireMerchantId();

  const statusPath = txnStatusPath(merchantId, transactionId);
  const endpoint = `${DQR_BASE}${statusPath}`;
  // Sign the logical path (no /enterprise-sandbox prefix), per the docs.
  const checksum = xVerify(statusPath);

  const res = await fetch(endpoint, {
    method: "GET",
    signal: AbortSignal.timeout(10000),
    headers: {
      "Content-Type": "application/json",
      "X-VERIFY": checksum,
      "X-MERCHANT-ID": merchantId,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PhonePe DQR status failed: ${res.status} ${text.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    success?: boolean;
    code?: string;
    data?: {
      paymentState?: string;
      state?: string;
      transactionId?: string;
      providerReferenceId?: string;
      amount?: number;
    };
  };

  // PhonePe spells the terminal state either `paymentState` (V1) or
  // `state` (V3) depending on the endpoint version — accept both.
  const raw = (data.data?.paymentState ?? data.data?.state ?? "").toUpperCase();
  const state: DqrState =
    raw === "COMPLETED"
      ? "COMPLETED"
      : raw === "FAILED" || raw === "EXPIRED"
        ? "FAILED"
        : "PENDING";

  return {
    success: state === "COMPLETED",
    state,
    providerReferenceId: data.data?.providerReferenceId,
    amount: data.data?.amount,
  };
}

/**
 * Verify a DQR S2S callback. PhonePe signs the base64 `response` body
 * with the V1 scheme: SHA256(base64Response + saltKey) + "###" + index.
 * Returns false if creds are missing (route then rejects).
 */
export function verifyDqrCallback(
  xVerifyHeader: string,
  base64Response: string,
): boolean {
  if (!DQR_SALT_KEY) return false;

  const expected = xVerify(base64Response);
  const provided = Buffer.from(xVerifyHeader);
  const expectedBuf = Buffer.from(expected);
  if (provided.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(provided, expectedBuf);
}

/** Decoded DQR callback payload. */
export interface DqrCallbackData {
  success: boolean;
  code: string;
  data: {
    merchantId: string;
    transactionId: string;
    providerReferenceId?: string;
    amount: number; // paise
    paymentState: string; // COMPLETED | FAILED
    paymentModes?: Array<{ mode: string; amount: number; utr?: string }>;
    transactionContext?: { storeId?: string; terminalId?: string };
  };
}

/** Decode the base64 `response` field from a DQR callback body. */
export function decodeDqrCallback(base64Response: string): DqrCallbackData {
  return JSON.parse(
    Buffer.from(base64Response, "base64").toString("utf-8"),
  ) as DqrCallbackData;
}
