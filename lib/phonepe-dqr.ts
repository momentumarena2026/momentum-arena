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

// DQR host env. Defaults to the shared PHONEPE_ENV, but can be set
// independently via PHONEPE_DQR_ENV so DQR can target PROD while the rest
// of the PhonePe integration (the v2 checkout in lib/phonepe.ts) stays on
// SANDBOX — e.g. testing prod DQR creds on a development deploy without
// flipping the shared flag (which would point the gateway at real money).
const DQR_ENV =
  process.env.PHONEPE_DQR_ENV || process.env.PHONEPE_ENV || "SANDBOX"; // "SANDBOX" | "PRODUCTION"
const isProd = DQR_ENV === "PRODUCTION";

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
const INTENT_INIT_PATH = "/v1/intent/init";
const QR_TXN_LIST_PATH = "/v3/qr/transaction/list";
const txnStatusPath = (merchantId: string, transactionId: string) =>
  `/v3/transaction/${encodeURIComponent(merchantId)}/${encodeURIComponent(
    transactionId,
  )}/status`;

// Which "generate a UPI request" product to use for the customer-facing
// UPI option. DQR (/v3/qr/init) is a scan QR; Open Intent (/v1/intent/init)
// returns a tappable upi:// link. We DEFAULT TO SCAN: UPI blocks tappable
// intent/link payments for our merchant VPA ("payment through a link is not
// allowed for this merchant — please scan the QR"), so the customer scans
// the QR (camera, or screenshot → scan-from-gallery on the same phone).
// Flip to the tappable product with PHONEPE_DQR_MODE=intent once PhonePe
// enables intent ACCEPTANCE on the VPA. Status + callback are identical.
export function isOpenIntentMode(): boolean {
  return (process.env.PHONEPE_DQR_MODE || "qr").toLowerCase() === "intent";
}

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
    // Surface the resolved env/host so a misconfig (e.g. PHONEPE_DQR_ENV not
    // applied → request hit UAT with prod creds) is self-evident instead of
    // showing PhonePe's opaque "try again later". Host/env are not secret.
    console.error(
      `[dqr] init failed env=${DQR_ENV} host=${DQR_BASE} status=${res.status} body=${text.slice(0, 300)}`,
    );
    throw new Error(
      `PhonePe DQR init failed [env=${DQR_ENV} host=${DQR_BASE}]: ${res.status} ${text.slice(0, 400)}`,
    );
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

/**
 * Generate an Open Intent for one transaction via /v1/intent/init. Returns
 * the same shape as {@link qrInit} — a `upi://pay?...` string (here a
 * tappable intent rather than a scan-only QR) plus a server-rendered QR
 * image — so callers, status polling and the callback stay identical. The
 * intent endpoint is the path that lets the same string be *tapped* to pay
 * (the /v3/qr/init string is registered scan-only). Same V1 X-VERIFY +
 * `{ request: base64 }` body + creds as qrInit.
 */
export async function intentInit(params: QrInitParams): Promise<QrInitResult> {
  const merchantId = requireMerchantId();

  // Intent Init validates `message` as "alphanumeric with - _ / @ only"
  // (no spaces, ₹ or em-dash — unlike /v3/qr/init which tolerates them), so
  // strip any other char to a hyphen and drop it if nothing's left.
  const safeMessage = params.message
    ? params.message.replace(/[^A-Za-z0-9/_@-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80)
    : "";

  const payload = {
    merchantId,
    transactionId: params.transactionId,
    merchantOrderId: params.transactionId,
    amount: params.amountPaise,
    storeId: DQR_STORE_ID,
    // Only no-customer-phone solution type Intent Init accepts; enablement
    // + this endpoint are what make the returned string tappable.
    solutionType: "DQR",
    intentExpiryInSeconds: params.expiresIn,
    ...(DQR_TERMINAL_ID ? { terminalId: DQR_TERMINAL_ID } : {}),
    ...(safeMessage ? { message: safeMessage } : {}),
  };

  const base64 = Buffer.from(JSON.stringify(payload)).toString("base64");
  const endpoint = `${DQR_BASE}${INTENT_INIT_PATH}`;
  const checksum = xVerify(base64 + INTENT_INIT_PATH);

  const res = await fetch(endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(10000),
    headers: {
      "Content-Type": "application/json",
      "X-VERIFY": checksum,
      "X-CALL-MODE": "POST",
      "X-CALLBACK-URL": params.callbackUrl,
    },
    body: JSON.stringify({ request: base64 }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(
      `[dqr] intent init failed env=${DQR_ENV} host=${DQR_BASE} status=${res.status} body=${text.slice(0, 300)}`,
    );
    throw new Error(
      `PhonePe intent init failed [env=${DQR_ENV} host=${DQR_BASE}]: ${res.status} ${text.slice(0, 400)}`,
    );
  }

  const data = (await res.json()) as {
    success?: boolean;
    code?: string;
    data?: { intentString?: string };
  };

  const intentString = data.data?.intentString;
  if (!data.success || !intentString) {
    throw new Error(
      `PhonePe intent init unsuccessful: code=${data.code ?? "?"} success=${data.success}`,
    );
  }

  const qrImage = await QRCode.toDataURL(intentString, {
    width: 320,
    margin: 1,
  });

  return { qrString: intentString, qrImage, transactionId: params.transactionId };
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

// ─── QR Transaction List API (admin reporting) ──────────────────────────────
//
// `POST /v3/qr/transaction/list` is the PhonePe "Integrated Static QR"
// reporting endpoint. Keyed on merchantId + storeId, it returns the
// transactions PhonePe recorded for our merchant QR codes — and because our
// Dynamic QR (qrInit) generates QRs under the SAME merchant + store, ONE call
// returns BOTH static-QR and DQR transactions (PhonePe's own truth). This is
// the source of truth for the admin PhonePe dashboard (`actions/admin-phonepe`),
// replacing the previous DB-derived view.
//
// Same V1 X-VERIFY + mercury host + `{ request: base64 }` body as qrInit, so it
// reuses this module's creds. Gated by `isDqrConfigured()` like everything else.
//
// ⚠️ Confirm at activation against the PhonePe sandbox: the exact per-transaction
// field names (esp. how the terminal status is reported — the docs say to read a
// per-txn `code`/`payResponseCode` rather than `paymentState`) and whether the
// list truly spans both products under one merchant+store, vs needing a separate
// static-QR merchantId.

/** One transaction row from the QR Transaction List API. */
export interface QrListTransaction {
  /** Our merchant transaction id (DQR ids are prefixed "DQR…"). */
  transactionId: string;
  /** PhonePe-side reference id. */
  providerReferenceId: string | null;
  /** Amount in paise. */
  amount: number;
  /** Terminal status. Docs flag `paymentState` as informational — prefer
   *  `payResponseCode` / top-level `code` when present. */
  paymentState: string | null;
  payResponseCode: string | null;
  /** PhonePe's transaction timestamp (string; format per their response). */
  transactionDate: string | null;
  /** Customer name + masked phone, when PhonePe returns them. */
  name: string | null;
  mobileNumber: string | null;
  paymentModes: Array<{ type?: string; mode?: string; amount?: number; utr?: string }>;
  transactionContext: {
    qrCodeId?: string;
    posDeviceId?: string;
    storeId?: string;
    terminalId?: string;
  } | null;
}

export interface QrTransactionListResult {
  resultCount: number;
  startTimestamp: number | null;
  endTimestamp: number | null;
  transactions: QrListTransaction[];
}

/**
 * Fetch the merchant's QR transactions (static + DQR) from PhonePe.
 *
 * The API filters by `startTimestamp` (ms) + `size` only — there is NO
 * end-timestamp and NO offset/cursor pagination — so callers fetch a window
 * from a start time and slice/window client-side. Throws on misconfig or a
 * non-2xx / unsuccessful response (the dashboard surfaces a friendly error).
 */
export async function qrTransactionList(params: {
  /** Max rows to return (the API's only volume control). */
  size: number;
  /** Window start, epoch ms. */
  startTimestamp: number;
  amountPaise?: number;
  last4Digits?: string;
  qrCodeId?: string;
  terminalId?: string;
}): Promise<QrTransactionListResult> {
  const merchantId = requireMerchantId();

  const payload = {
    size: params.size,
    merchantId,
    storeId: DQR_STORE_ID,
    startTimestamp: params.startTimestamp,
    ...(params.amountPaise != null ? { amount: params.amountPaise } : {}),
    ...(params.last4Digits ? { last4Digits: params.last4Digits } : {}),
    ...(params.qrCodeId ? { qrCodeId: params.qrCodeId } : {}),
    ...(params.terminalId
      ? { terminalId: params.terminalId }
      : DQR_TERMINAL_ID
        ? { terminalId: DQR_TERMINAL_ID }
        : {}),
  };

  const base64 = Buffer.from(JSON.stringify(payload)).toString("base64");
  const endpoint = `${DQR_BASE}${QR_TXN_LIST_PATH}`;
  // Sign the logical path (no /enterprise-sandbox prefix), per the docs.
  const checksum = xVerify(base64 + QR_TXN_LIST_PATH);

  const res = await fetch(endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: {
      "Content-Type": "application/json",
      "X-VERIFY": checksum,
    },
    body: JSON.stringify({ request: base64 }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(
      `[dqr] txn-list failed env=${DQR_ENV} host=${DQR_BASE} status=${res.status} body=${text.slice(0, 300)}`,
    );
    throw new Error(
      `PhonePe QR transaction list failed [env=${DQR_ENV} host=${DQR_BASE}]: ${res.status} ${text.slice(0, 400)}`,
    );
  }

  const json = (await res.json()) as {
    success?: boolean;
    code?: string;
    data?: {
      resultCount?: number;
      startTimestamp?: number;
      endTimestamp?: number;
      transactions?: Array<Record<string, unknown>>;
    };
  };

  if (!json.success) {
    throw new Error(
      `PhonePe QR transaction list unsuccessful: code=${json.code ?? "?"}`,
    );
  }

  const raw = json.data?.transactions ?? [];
  const transactions: QrListTransaction[] = raw.map((t) => {
    const ctx = (t.transactionContext ?? null) as QrListTransaction["transactionContext"];
    const modes = Array.isArray(t.paymentModes)
      ? (t.paymentModes as QrListTransaction["paymentModes"])
      : [];
    return {
      transactionId: String(t.transactionId ?? ""),
      providerReferenceId:
        t.providerReferenceId != null ? String(t.providerReferenceId) : null,
      amount: typeof t.amount === "number" ? t.amount : Number(t.amount ?? 0),
      paymentState: t.paymentState != null ? String(t.paymentState) : null,
      payResponseCode:
        t.payResponseCode != null ? String(t.payResponseCode) : null,
      transactionDate:
        t.transactionDate != null ? String(t.transactionDate) : null,
      name: t.name != null ? String(t.name) : null,
      mobileNumber:
        t.mobileNumber != null
          ? String(t.mobileNumber)
          : t.phoneNumber != null
            ? String(t.phoneNumber)
            : null,
      paymentModes: modes,
      transactionContext: ctx,
    };
  });

  return {
    resultCount: json.data?.resultCount ?? transactions.length,
    startTimestamp: json.data?.startTimestamp ?? null,
    endTimestamp: json.data?.endTimestamp ?? null,
    transactions,
  };
}

/** Whether the QR transaction-list reporting is usable (same creds as DQR). */
export function isQrReportingConfigured(): boolean {
  return isDqrConfigured();
}
