import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { db } from "@/lib/db";

/**
 * Cancel a PENDING_PAYMENT cafe order — called from the checkout
 * client when the customer dismisses the Razorpay modal without
 * paying, or when the gateway reports a hard failure. Mirrors how
 * the sports-booking flow lets an abandoned hold expire; here the
 * dismiss is explicit so we cancel it eagerly.
 *
 * Safety:
 *   - Only the order's owner can cancel it.
 *   - Only PENDING_PAYMENT orders are cancellable here; anything
 *     past that is the admin's domain (use the admin cancel path
 *     instead, which also restores stock for orders that had it
 *     decremented).
 *   - Stock is NOT touched here — PENDING_PAYMENT orders never
 *     decremented it in the first place. The coupon usage that
 *     was burned at intent time IS rolled back so the customer
 *     can retry with the same code.
 */
export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { orderId, reason } = await request.json();
  if (!orderId) {
    return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
  }

  const order = await db.cafeOrder.findUnique({
    where: { id: orderId },
    include: { payment: true },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.userId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Idempotent — if already CANCELLED, return success.
  if (order.status === "CANCELLED") {
    return NextResponse.json({ success: true, alreadyCancelled: true });
  }

  if (order.status !== "PENDING_PAYMENT") {
    return NextResponse.json(
      {
        error:
          "Order can no longer be cancelled from the checkout. Contact the venue if you need a refund.",
      },
      { status: 409 },
    );
  }

  await db.$transaction(async (tx) => {
    await tx.cafeOrder.update({
      where: { id: orderId },
      data: { status: "CANCELLED" },
    });
    if (order.payment) {
      await tx.cafePayment.update({
        where: { id: order.payment.id },
        data: {
          status: "FAILED",
          refundReason: reason || "Customer cancelled at checkout",
        },
      });
    }
    // Return the coupon usage that was burned at intent time so
    // the customer can retry with the same code.
    if (order.discountCodeId && order.discountAmount > 0) {
      await tx.cafeDiscount.update({
        where: { id: order.discountCodeId },
        data: { usedCount: { decrement: 1 } },
      });
    }
  });

  return NextResponse.json({ success: true });
}
