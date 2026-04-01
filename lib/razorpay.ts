import crypto from "crypto";

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
  console.warn("WARNING: RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET not set. Razorpay payments will fail.");
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
