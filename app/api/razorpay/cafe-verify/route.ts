import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { db } from "@/lib/db";
import { verifyRazorpaySignature } from "@/lib/razorpay";
import { materializeOrderFromIntent } from "@/lib/cafe-intent";

/**
 * Verify Razorpay payment + materialise the real CafeOrder from
 * the CafePaymentIntent. Until this endpoint runs successfully, NO
 * CafeOrder exists in the database — the intent table holds the
 * cart while the customer is in the modal.
 *
 * Steps:
 *   1. Verify the Razorpay signature.
 *   2. Look up the intent by the `orderId` (which is the intent id
 *      passed in by the client).
 *   3. Idempotency — if already consumed, return the existing
 *      orderId.
 *   4. `materializeOrderFromIntent` creates the CafeOrder + items +
 *      payment in a single transaction, decrements Ready stock
 *      atomically, routes status (allReady → COMPLETED, else
 *      PENDING), burns the coupon, and marks the intent consumed.
 *   5. Sold-out-after-payment race → the helper creates a CANCELLED
 *      order with the captured payment info so admin can issue a
 *      refund, and we surface `refundRequired: true` to the client.
 */
export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { orderId, razorpayPaymentId, razorpayOrderId, razorpaySignature } =
    await request.json();

  if (!orderId || !razorpayPaymentId || !razorpayOrderId || !razorpaySignature) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const intent = await db.cafePaymentIntent.findUnique({
    where: { id: orderId },
  });
  if (!intent) {
    // Could be a duplicate verify call (intent already consumed +
    // deleted by sweeper) — look up the materialised order by
    // razorpayOrderId so the customer sees their confirmation.
    const existingPayment = await db.cafePayment.findFirst({
      where: { razorpayOrderId },
      select: { orderId: true, order: { select: { status: true } } },
    });
    if (existingPayment?.orderId) {
      return NextResponse.json({
        success: true,
        orderId: existingPayment.orderId,
        status: existingPayment.order?.status ?? "PENDING",
      });
    }
    return NextResponse.json(
      { error: "Checkout session expired — please start again" },
      { status: 410 },
    );
  }

  if (intent.userId && intent.userId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (intent.razorpayOrderId && intent.razorpayOrderId !== razorpayOrderId) {
    return NextResponse.json({ error: "Order mismatch" }, { status: 400 });
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

  const result = await materializeOrderFromIntent(intent.id, {
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        refundRequired: !!result.refundOrderId,
        orderId: result.refundOrderId, // null when there's no audit row
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    success: true,
    orderId: result.orderId,
    orderNumber: result.orderNumber,
    status: result.status,
  });
}
