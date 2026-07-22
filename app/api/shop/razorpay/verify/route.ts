import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { verifyRazorpaySignature } from "@/lib/razorpay";
import { confirmOrderAfterRazorpay } from "@/actions/shop-order";

/**
 * POST /api/shop/razorpay/verify
 *
 * Body: { orderId, razorpayPaymentId, razorpayOrderId, razorpaySignature }
 *
 * Validates the HMAC signature, then flips the ProductOrder +
 * ProductOrderPayment to CONFIRMED + COMPLETED. Idempotent.
 */
export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { orderId, razorpayPaymentId, razorpayOrderId, razorpaySignature } = body;
  if (!orderId || !razorpayPaymentId || !razorpayOrderId || !razorpaySignature) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const sigOk = verifyRazorpaySignature(
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
  );
  if (!sigOk) {
    return NextResponse.json(
      { error: "Invalid payment signature" },
      { status: 400 },
    );
  }

  // Pass the identity this route already resolved — getAuthUserId also
  // accepts a mobile bearer token, which the action's own auth() fallback
  // cannot see (matches the mobile twin).
  const res = await confirmOrderAfterRazorpay(
    orderId,
    razorpayPaymentId,
    razorpayOrderId,
    razorpaySignature,
  );
  if (!res.success) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }
  return NextResponse.json({ success: true, orderId });
}
