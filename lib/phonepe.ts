import crypto from "crypto";

/**
 * PhonePe Standard Checkout v2 (OAuth-based).
 *
 * Replaces the legacy V1 X-VERIFY scheme. Key differences:
 *
 *   - Auth: client_id + client_secret + client_version are exchanged
 *     once for a short-lived OAuth access token (~30 min TTL); every
 *     API call uses `Authorization: O-Bearer <token>`. We cache the
 *     token in memory with a 60s safety margin so a refresh never
 *     happens mid-request.
 *
 *   - Endpoints: `/checkout/v2/pay` (initiate) and
 *     `/checkout/v2/order/{merchantOrderId}/status` (S2S poll).
 *     The "merchantOrderId" identifier replaces v1's
 *     "merchantTransactionId" — semantically the same (we generate
 *     it), so the schema column `phonePeMerchantTxnId` keeps storing
 *     this value without a rename.
 *
 *   - Webhook: PhonePe authenticates the S2S callback with HTTP
 *     Basic-style `Authorization: sha256(username:password)` —
 *     username/password are configured in the dashboard's Webhooks
 *     tab and live in the PHONEPE_WEBHOOK_* env vars below.
 *
 * Static QR (PhonePe Business QR codes shown at the venue) is a
 * separate product with its own legacy V1-style signing scheme; it
 * lives in `lib/phonepe-static-qr.ts` to keep its credentials
 * isolated from the checkout flow.
 */

const PHONEPE_CLIENT_ID = process.env.PHONEPE_CLIENT_ID;
const PHONEPE_CLIENT_SECRET = process.env.PHONEPE_CLIENT_SECRET;
const PHONEPE_CLIENT_VERSION = process.env.PHONEPE_CLIENT_VERSION || "1";
const PHONEPE_ENV = process.env.PHONEPE_ENV || "SANDBOX"; // "SANDBOX" | "PRODUCTION"
const PHONEPE_WEBHOOK_USERNAME = process.env.PHONEPE_WEBHOOK_USERNAME;
const PHONEPE_WEBHOOK_PASSWORD = process.env.PHONEPE_WEBHOOK_PASSWORD;

const isProd = PHONEPE_ENV === "PRODUCTION";

// PG (payment gateway) base — initiate + status calls go here.
const PHONEPE_BASE_URL = isProd
  ? "https://api.phonepe.com/apis/pg"
  : "https://api-preprod.phonepe.com/apis/pg-sandbox";

// OAuth token endpoint. Note the host differs between sandbox and
// production: production lives on a dedicated identity-manager
// service, sandbox is colocated with the pg-sandbox API.
const PHONEPE_OAUTH_URL = isProd
  ? "https://api.phonepe.com/apis/identity-manager/v1/oauth/token"
  : "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token";

if (!PHONEPE_CLIENT_ID || !PHONEPE_CLIENT_SECRET) {
  console.warn(
    "WARNING: PHONEPE_CLIENT_ID or PHONEPE_CLIENT_SECRET not set. PhonePe payments will fail.",
  );
}

// ─── OAuth token cache ────────────────────────────────────────────
// Module-level scope: in a long-running process the cache is shared
// across requests; in serverless it's per cold-start, which is fine
// — a 30-min token easily covers a single Lambda's lifetime.

interface TokenCache {
  value: string;
  // expiresAt is a JS millisecond timestamp (PhonePe returns unix
  // seconds; we convert in `getAccessToken`).
  expiresAt: number;
}

let cachedToken: TokenCache | null = null;
// Reuse the same in-flight token request so concurrent first-time
// callers don't fire N parallel OAuth requests.
let pendingTokenPromise: Promise<string> | null = null;

async function fetchAccessToken(): Promise<string> {
  if (!PHONEPE_CLIENT_ID || !PHONEPE_CLIENT_SECRET) {
    throw new Error(
      "PhonePe credentials missing — set PHONEPE_CLIENT_ID and PHONEPE_CLIENT_SECRET",
    );
  }

  // PhonePe's OAuth endpoint is form-urlencoded, not JSON.
  const body = new URLSearchParams({
    client_id: PHONEPE_CLIENT_ID,
    client_version: PHONEPE_CLIENT_VERSION,
    client_secret: PHONEPE_CLIENT_SECRET,
    grant_type: "client_credentials",
  });

  const res = await fetch(PHONEPE_OAUTH_URL, {
    method: "POST",
    signal: AbortSignal.timeout(10000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PhonePe OAuth failed: ${res.status} ${text}`);
  }

  // Shape: { access_token, expires_at (unix seconds), token_type, … }
  const data = (await res.json()) as {
    access_token: string;
    expires_at?: number;
    expires_in?: number;
  };

  // Prefer expires_at when provided; fall back to expires_in offset.
  const expiresAtMs = data.expires_at
    ? data.expires_at * 1000
    : Date.now() + (data.expires_in ?? 1800) * 1000;

  cachedToken = { value: data.access_token, expiresAt: expiresAtMs };
  return data.access_token;
}

async function getAccessToken(): Promise<string> {
  // 60-second buffer so we never use a token that's about to expire
  // mid-request. PhonePe rejects expired tokens with 401 and we'd
  // otherwise have to handle the retry path.
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }

  // Coalesce concurrent refreshes — when N requests arrive cold
  // together, only one OAuth call should fire.
  if (pendingTokenPromise) return pendingTokenPromise;

  pendingTokenPromise = fetchAccessToken().finally(() => {
    pendingTokenPromise = null;
  });

  return pendingTokenPromise;
}

// ─── Public API ───────────────────────────────────────────────────

export interface InitiatePaymentResult {
  /** PhonePe-hosted page the user should be redirected to. */
  redirectUrl: string;
  /** Server-side order id assigned by PhonePe (`OM...`). */
  orderId: string;
  /**
   * Echoed back so callers don't have to track it separately —
   * matches what they passed in. Stored on Payment as
   * `phonePeMerchantTxnId` (column kept legacy-named to avoid a
   * pointless schema migration).
   */
  merchantOrderId: string;
}

/**
 * Kick off a checkout — returns the URL the client should redirect
 * the user to. The user pays on a PhonePe-hosted page and is then
 * redirected to `redirectUrl` (which we control via
 * `paymentFlow.merchantUrls.redirectUrl`).
 */
export async function initiatePhonePePayment({
  merchantOrderId,
  amount,
  redirectUrl,
  message,
}: {
  /** Our unique order identifier (≤63 chars). Reused as the lookup
   *  key when PhonePe's webhook fires or when we redirect-poll. */
  merchantOrderId: string;
  /** Amount in paise (matches our DB convention). */
  amount: number;
  /** Where the PhonePe-hosted page should send the user back to. */
  redirectUrl: string;
  /** Cosmetic — shown on the PhonePe payment page header. */
  message?: string;
}): Promise<InitiatePaymentResult> {
  const token = await getAccessToken();

  const body = {
    merchantOrderId,
    amount,
    // 20 minutes — comfortably covers a UPI collect flow without
    // letting an abandoned hold sit forever.
    expireAfter: 1200,
    paymentFlow: {
      type: "PG_CHECKOUT",
      message: message ?? "Payment for Momentum Arena",
      merchantUrls: { redirectUrl },
    },
  };

  const res = await fetch(`${PHONEPE_BASE_URL}/checkout/v2/pay`, {
    method: "POST",
    signal: AbortSignal.timeout(10000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `O-Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PhonePe initiate failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    orderId: string;
    state: string;
    redirectUrl: string;
    expireAt: number;
  };

  return {
    redirectUrl: data.redirectUrl,
    orderId: data.orderId,
    merchantOrderId,
  };
}

export type PhonePeOrderState = "PENDING" | "COMPLETED" | "FAILED";

export interface CheckStatusResult {
  /**
   * Convenience boolean — true iff the order has been settled
   * successfully. Mirrors the legacy SDK's `success` field so call
   * sites can stay roughly the same shape.
   */
  success: boolean;
  state: PhonePeOrderState;
  /** PhonePe-side order id (`OM...`). Stored as
   *  `Payment.phonePeTransactionId` for downstream support tickets. */
  transactionId: string;
  amount: number;
}

/**
 * Server-to-server poll. Used by the redirect handler (when the
 * user lands back on our site) and by the webhook handler (as a
 * second-source verification before we trust the webhook payload
 * enough to create a Booking).
 */
export async function checkPhonePeStatus(
  merchantOrderId: string,
): Promise<CheckStatusResult> {
  const token = await getAccessToken();

  // `details=true` returns the full `paymentDetails` array; we want
  // the inner transactionId for our records, so it's worth the
  // slightly bigger payload.
  const res = await fetch(
    `${PHONEPE_BASE_URL}/checkout/v2/order/${encodeURIComponent(
      merchantOrderId,
    )}/status?details=true`,
    {
      method: "GET",
      signal: AbortSignal.timeout(10000),
      headers: { Authorization: `O-Bearer ${token}` },
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PhonePe status failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    orderId: string;
    state: PhonePeOrderState;
    amount: number;
    paymentDetails?: Array<{
      transactionId?: string;
      state?: PhonePeOrderState;
    }>;
  };

  // Order can be COMPLETED with multiple paymentDetails (e.g. a
  // retried collect). Pick the COMPLETED one if present, else
  // whichever transactionId we got first.
  const settled = data.paymentDetails?.find((p) => p.state === "COMPLETED");
  const transactionId =
    settled?.transactionId ?? data.paymentDetails?.[0]?.transactionId ?? "";

  return {
    success: data.state === "COMPLETED",
    state: data.state,
    transactionId,
    amount: data.amount,
  };
}

/**
 * Verify a PhonePe v2 webhook. Auth header should be the SHA256 of
 * `<username>:<password>` (the values you configured in the
 * Webhooks tab and stored in PHONEPE_WEBHOOK_USERNAME /
 * PHONEPE_WEBHOOK_PASSWORD). Returns false on any of: missing
 * header, missing env, mismatch.
 */
export function verifyPhonePeWebhook(
  authorizationHeader: string | null,
): boolean {
  if (
    !authorizationHeader ||
    !PHONEPE_WEBHOOK_USERNAME ||
    !PHONEPE_WEBHOOK_PASSWORD
  ) {
    return false;
  }

  const expected = crypto
    .createHash("sha256")
    .update(`${PHONEPE_WEBHOOK_USERNAME}:${PHONEPE_WEBHOOK_PASSWORD}`)
    .digest("hex");

  // Constant-time comparison — defends against timing attacks
  // attempting to leak the secret one byte at a time.
  const provided = Buffer.from(authorizationHeader);
  const expectedBuf = Buffer.from(expected);
  if (provided.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(provided, expectedBuf);
}

// Shape of the v2 webhook body. Provided here for callback handlers
// to type their JSON parsing — the actual auth happens via
// `verifyPhonePeWebhook`.
//
// PhonePe's webhook event taxonomy as exposed in the dashboard's
// "Active Events" picker uses the `pg.*` namespace for the Standard
// Checkout product. The fallback `string` keeps us forward-compatible
// when PhonePe adds events without breaking type-narrowing in
// downstream switch statements.
export interface PhonePeWebhookBody {
  event:
    | "pg.order.completed"
    | "pg.order.failed"
    | "pg.refund.completed"
    | "pg.refund.failed"
    | string;
  payload: {
    orderId: string;
    merchantOrderId: string;
    originalMerchantOrderId?: string;
    state: PhonePeOrderState;
    amount: number;
    paymentDetails?: Array<{
      transactionId?: string;
      paymentMode?: string;
      state?: PhonePeOrderState;
    }>;
  };
}
