import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { db } from "@/lib/db";
import { completePassTopup } from "@/lib/pass-topup";
import { recordOrphanPayment } from "@/lib/payment-orphan";
import { verifyRazorpaySignature } from "@/lib/razorpay";

/** Complete a pass top-up: gateway remainder captured → create the
 *  booking (RAZORPAY, the ORDER's amount) and debit the covered hours.
 *  Delegates to completePassTopup — the same helper the
 *  payment.captured webhook uses — so both paths stay identical. */
export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const { holdId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = body;
  if (!holdId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  if (!verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
    return NextResponse.json({ error: "Signature mismatch" }, { status: 400 });
  }

  // Idempotency: the webhook may already have completed this payment.
  const existing = await db.payment.findFirst({
    where: { razorpayPaymentId },
    select: { bookingId: true },
  });
  if (existing) {
    return NextResponse.json({ bookingId: existing.bookingId });
  }

  // Fetch WITHOUT the expiry filter — a payment can land after the
  // 15-min hold TTL, and the stamped order keeps the row alive for the
  // 24h grace window (cleanupExpiredHolds). A hold that's fully gone
  // means captured money with no blueprint: an ORPHAN, never a "retry".
  const hold = await db.slotHold.findUnique({
    where: { id: holdId },
    include: { courtConfig: true },
  });
  if (!hold) {
    recordOrphanPayment({
      gateway: "RAZORPAY",
      reason: "no-hold",
      userId,
      razorpayOrderId,
      razorpayPaymentId,
      holdId,
      path: request.nextUrl.pathname,
    });
    return NextResponse.json(
      {
        error:
          "Payment received, but your slot reservation had expired. Please do NOT pay again — our team will confirm your booking or refund you shortly.",
        paymentReceived: true,
      },
      { status: 410 },
    );
  }
  if (hold.userId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await completePassTopup({
    hold,
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
    path: request.nextUrl.pathname,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ bookingId: result.bookingId });
}
