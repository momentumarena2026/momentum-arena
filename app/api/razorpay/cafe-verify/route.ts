import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { db } from "@/lib/db";
import { verifyRazorpaySignature } from "@/lib/razorpay";
import { finalizePaidCafeOrder } from "@/lib/cafe-finalize";

/**
 * Razorpay verify endpoint for cafe orders — the "payment-first"
 * commit step. Mirrors the sports-booking verify flow:
 *   - Customer's order is sitting in PENDING_PAYMENT (no stock
 *     decrement, hidden from admin tabs).
 *   - We verify the Razorpay signature, mark the payment
 *     COMPLETED, then run `finalizePaidCafeOrder` which atomically
 *     decrements Ready-line stock and flips order status
 *     (allReady → COMPLETED, else PENDING).
 *   - If the finalize step hits a sold-out race (someone took the
 *     last unit between intent and verify), the order is cancelled
 *     and we surface `refundRequired: true` so the operator knows
 *     to issue a refund out-of-band.
 */
export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { orderId, razorpayPaymentId, razorpayOrderId, razorpaySignature } =
    await request.json();

  const payment = await db.cafePayment.findFirst({
    where: { order: { id: orderId } },
    include: { order: { select: { userId: true, status: true } } },
  });

  if (!payment || payment.order.userId !== userId) {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }

  // Idempotency — duplicate verify call (user double-clicked, or
  // webhook + client both fired). If the order has already left
  // PENDING_PAYMENT, the state machine has advanced; return the
  // current state instead of trying to advance it again.
  if (
    payment.status === "COMPLETED" &&
    payment.order.status !== "PENDING_PAYMENT"
  ) {
    return NextResponse.json({
      success: true,
      orderId,
      status: payment.order.status,
    });
  }

  // Verify signature
  const isValid = verifyRazorpaySignature(
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
  );

  if (!isValid) {
    return NextResponse.json(
      { error: "Invalid payment signature" },
      { status: 400 },
    );
  }

  // Mark payment COMPLETED first so a finalize crash still leaves
  // a trail of "what was paid for" — the admin recovery page can
  // pick it up from there.
  await db.cafePayment.update({
    where: { id: payment.id },
    data: {
      status: "COMPLETED",
      razorpayPaymentId,
      razorpaySignature,
      confirmedAt: new Date(),
    },
  });

  const result = await finalizePaidCafeOrder(orderId);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, refundRequired: true },
      { status: 409 },
    );
  }

  return NextResponse.json({
    success: true,
    orderId,
    status: result.status,
  });
}
