import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { verifyRazorpaySignature } from "@/lib/razorpay";
import { materializeUserPass, parseStartDate } from "@/lib/passes";

/** Client-side confirmation after the Razorpay modal succeeds. The
 *  payment.captured webhook is the backstop — both paths are
 *  idempotent on razorpayOrderId. Unified auth (web cookie or mobile
 *  bearer token). */
export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const { planId, razorpayOrderId, razorpayPaymentId, razorpaySignature, startDate } = body;
  if (!planId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  if (!verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
    return NextResponse.json({ error: "Signature mismatch" }, { status: 400 });
  }
  const result = await materializeUserPass({
    razorpayOrderId,
    razorpayPaymentId,
    planId,
    userId,
    startsAt: parseStartDate(startDate),
  });
  if (!result) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true, userPassId: result.userPassId });
}
