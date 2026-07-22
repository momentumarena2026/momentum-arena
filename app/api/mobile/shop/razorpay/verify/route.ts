import { NextRequest, NextResponse } from "next/server";
import { getMobileUser } from "@/lib/mobile-auth";
import { verifyRazorpaySignature } from "@/lib/razorpay";
import { confirmOrderAfterRazorpay } from "@/actions/shop-order";

/**
 * POST /api/mobile/shop/razorpay/verify
 * Body: { orderId, razorpayPaymentId, razorpayOrderId, razorpaySignature }
 */
export async function POST(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
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
