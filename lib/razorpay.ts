import crypto from "crypto";

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
  console.warn("WARNING: RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET not set. Razorpay payments will fail.");
}

if (!RAZORPAY_WEBHOOK_SECRET) {
  console.warn(
    "WARNING: RAZORPAY_WEBHOOK_SECRET not set. The /api/razorpay/webhook endpoint will reject all events.",
  );
}

export { RAZORPAY_KEY_ID };

interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

// Create a Razorpay order
export async function createRazorpayOrder(
  amount: number, // in rupees
  bookingId: string,
  offerId?: string
): Promise<RazorpayOrder> {
  const auth = Buffer.from(
    `${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`
  ).toString("base64");

  const body: Record<string, unknown> = {
    amount: Math.round(amount * 100), // Razorpay expects paise
    currency: "INR",
    receipt: bookingId,
    notes: { bookingId },
  };

  if (offerId) {
    body.offer_id = offerId;
  }

  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    signal: AbortSignal.timeout(8000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Razorpay order creation failed: ${error}`);
  }

  return response.json();
}

// Verify Razorpay payment signature
export function verifyRazorpaySignature(
  orderId: string,
  paymentId: string,
  signature: string
): boolean {
  const body = `${orderId}|${paymentId}`;
  const expectedSignature = crypto
    .createHmac("sha256", RAZORPAY_KEY_SECRET || "")
    .update(body)
    .digest("hex");
  return expectedSignature === signature;
}

/**
 * Verify a server-to-server webhook delivery from Razorpay. Razorpay
 * signs the raw request body with HMAC-SHA256 using the webhook
 * secret (configured per-endpoint in the Razorpay dashboard) and sends
 * the hex digest in the `X-Razorpay-Signature` header.
 *
 * IMPORTANT: pass the EXACT raw body string the request arrived with —
 * any whitespace normalisation breaks the signature match. The route
 * handler should use `request.text()` and pass the result here as-is.
 */
export function verifyRazorpayWebhookSignature(
  rawBody: string,
  signature: string,
): boolean {
  if (!RAZORPAY_WEBHOOK_SECRET) return false;
  const expected = crypto
    .createHmac("sha256", RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  // crypto.timingSafeEqual requires equal-length buffers; check first.
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signature),
  );
}

/**
 * Fetch a payment record from Razorpay by paymentId. Used by the
 * admin recovery tool: when a customer's verify call dropped, the
 * money is captured in Razorpay but our DB has no Payment row. Admin
 * pastes the paymentId, we fetch the order metadata (including the
 * receipt = our internal bookingId / orderId reference) and
 * reconstruct the Booking.
 *
 * Returns the raw Razorpay payment object — caller picks the fields
 * it needs. Throws on non-2xx responses.
 */
export interface RazorpayPaymentRecord {
  id: string; // pay_…
  entity: "payment";
  amount: number; // paise
  currency: string;
  status: string; // "captured", "authorized", "failed", "refunded"…
  order_id: string;
  method: string;
  captured: boolean;
  email: string | null;
  contact: string | null;
  notes: Record<string, string> | null;
  created_at: number; // unix ts seconds
}

/**
 * Fetch an order record from Razorpay by orderId. The client-side
 * signature only proves a capture happened — WHAT was bought (notes)
 * and for HOW MUCH (amount, paise) must be re-read from the order we
 * created server-side, never trusted from the client's payload.
 *
 * NOTE: Razorpay serialises empty notes as `[]` — treat non-object
 * notes as absent.
 */
export interface RazorpayOrderRecord {
  id: string; // order_…
  entity: "order";
  amount: number; // paise
  amount_paid: number; // paise
  amount_due: number; // paise
  currency: string;
  receipt: string | null;
  status: string; // "created" | "attempted" | "paid"
  notes: Record<string, string> | string[] | null;
  created_at: number; // unix ts seconds
}

export async function fetchRazorpayOrder(
  orderId: string,
): Promise<RazorpayOrderRecord> {
  const auth = Buffer.from(
    `${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`,
  ).toString("base64");
  const response = await fetch(
    `https://api.razorpay.com/v1/orders/${encodeURIComponent(orderId)}`,
    {
      method: "GET",
      signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Basic ${auth}` },
    },
  );
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Razorpay order fetch failed: ${error}`);
  }
  return response.json();
}

export async function fetchRazorpayPayment(
  paymentId: string,
): Promise<RazorpayPaymentRecord> {
  const auth = Buffer.from(
    `${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`,
  ).toString("base64");
  const response = await fetch(
    `https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`,
    {
      method: "GET",
      signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Basic ${auth}` },
    },
  );
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Razorpay payment fetch failed: ${error}`);
  }
  return response.json();
}
