import { db } from "./db";

/**
 * Result shape for `finalizePaidCafeOrder`. Kept as a plain
 * serialisable object so route handlers can `return NextResponse
 * .json(result)` directly.
 */
export type FinalizeResult =
  | { ok: true; status: "PENDING" | "COMPLETED"; allReady: boolean }
  | { ok: false; error: string; soldOutItemName?: string };

/**
 * Finalize a cafe order after its payment has been confirmed by a
 * gateway. This is the SHARED commit step for both Razorpay verify
 * and PhonePe callback/redirect — kept in one place so the
 * payment-first flow has identical semantics across gateways.
 *
 * Steps:
 *   1. Skip if the order isn't in PENDING_PAYMENT (idempotent for
 *      duplicate callbacks).
 *   2. Atomically decrement stock for every Ready (non-null
 *      CafeItem.quantity) line. If any line refuses (race lost
 *      between intent and verify), roll back the prior decrements
 *      in this call, mark the order CANCELLED, and surface the
 *      failure so the caller can flag a refund.
 *   3. Flip the order status: every line Ready → COMPLETED (skip
 *      kitchen pipeline, hand over at counter), else → PENDING
 *      (live board picks it up).
 */
export async function finalizePaidCafeOrder(
  orderId: string,
): Promise<FinalizeResult> {
  const order = await db.cafeOrder.findUnique({
    where: { id: orderId },
    include: { items: true },
  });

  if (!order) {
    return { ok: false, error: "Order not found" };
  }

  // Idempotency — duplicate webhooks, retries, or a user that
  // double-submits the verify call. If we've already advanced the
  // order past PENDING_PAYMENT, the work is done.
  if (order.status !== "PENDING_PAYMENT") {
    const allReady = await isAllReadyOrder(order.items);
    return {
      ok: true,
      status: order.status === "COMPLETED" ? "COMPLETED" : "PENDING",
      allReady,
    };
  }

  const cafeItemIds = order.items.map((i) => i.cafeItemId);
  const cafeItems = await db.cafeItem.findMany({
    where: { id: { in: cafeItemIds } },
    select: { id: true, name: true, quantity: true },
  });
  const itemMap = new Map(cafeItems.map((i) => [i.id, i]));

  // Decrement Ready items one at a time with a gte guard so a
  // race-loss matches zero rows instead of pushing stock negative.
  const decremented: Array<{ id: string; quantity: number }> = [];
  for (const line of order.items) {
    const cafeItem = itemMap.get(line.cafeItemId);
    if (!cafeItem || cafeItem.quantity === null) continue; // Prepare item
    const updated = await db.cafeItem.updateMany({
      where: {
        id: line.cafeItemId,
        quantity: { gte: line.quantity },
      },
      data: { quantity: { decrement: line.quantity } },
    });
    if (updated.count === 0) {
      // Roll back already-decremented lines so the counter stays
      // honest — the customer's payment will be refunded by the
      // admin out-of-band.
      for (const rb of decremented) {
        await db.cafeItem.update({
          where: { id: rb.id },
          data: { quantity: { increment: rb.quantity } },
        });
      }
      await db.cafeOrder.update({
        where: { id: orderId },
        data: { status: "CANCELLED" },
      });
      return {
        ok: false,
        error: `${cafeItem.name} sold out before we could confirm your order. Your payment will be refunded.`,
        soldOutItemName: cafeItem.name,
      };
    }
    decremented.push({ id: line.cafeItemId, quantity: line.quantity });
  }

  const allReady = order.items.every(
    (line) => itemMap.get(line.cafeItemId)?.quantity !== null,
  );
  const nextStatus: "PENDING" | "COMPLETED" = allReady ? "COMPLETED" : "PENDING";

  await db.cafeOrder.update({
    where: { id: orderId },
    data: { status: nextStatus },
  });

  return { ok: true, status: nextStatus, allReady };
}

async function isAllReadyOrder(
  items: { cafeItemId: string }[],
): Promise<boolean> {
  const ids = items.map((i) => i.cafeItemId);
  if (ids.length === 0) return false;
  const cafeItems = await db.cafeItem.findMany({
    where: { id: { in: ids } },
    select: { quantity: true },
  });
  return cafeItems.every((c) => c.quantity !== null);
}

/**
 * Cancel a PENDING_PAYMENT cafe order (PhonePe redirect failure,
 * Razorpay modal dismiss, etc). Stock isn't touched — these orders
 * never decremented inventory. Coupon usage burned at intent time
 * is returned so the customer can retry with the same code.
 */
export async function cancelPendingPaymentOrder(
  orderId: string,
  reason: string,
): Promise<void> {
  const order = await db.cafeOrder.findUnique({
    where: { id: orderId },
    include: { payment: true },
  });
  if (!order || order.status !== "PENDING_PAYMENT") return;

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
          refundReason: reason,
        },
      });
    }
    if (order.discountCodeId && order.discountAmount > 0) {
      await tx.cafeDiscount.update({
        where: { id: order.discountCodeId },
        data: { usedCount: { decrement: 1 } },
      });
    }
  });
}
