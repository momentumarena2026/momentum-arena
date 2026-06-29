import { db } from "./db";
import { normalizeIndianPhone } from "./phone";
import type { PaymentMethod } from "@prisma/client";

// Intents live for 30 min. Past that, the sweeper deletes them so
// the table doesn't fill up with abandoned modals. Customer keeps
// the same TTL as the Razorpay modal default.
const INTENT_TTL_MINUTES = 30;

/**
 * Shape of a single cart line stored in CafePaymentIntent.cart.
 * Plain JSON so the intent row can be hydrated without a join.
 */
export interface CafeCartLine {
  cafeItemId: string;
  quantity: number;
}

/**
 * Args for `createCafePaymentIntent` — the cart + customer info +
 * pre-validated totals (callers compute these the same way the
 * old createCafeOrder did, including coupon application).
 */
export interface CreateIntentArgs {
  userId: string | null;
  guestName: string | null;
  guestPhone: string | null;
  note: string | null;
  paymentMethod: PaymentMethod;
  cart: CafeCartLine[];
  totalAmount: number;
  originalAmount: number;
  discountAmount: number;
  discountCodeId: string | null;
}

/**
 * Stash a checkout intent. Returns the intent id which the client
 * uses on the gateway-create-order call. NO CafeOrder is created
 * yet — that only happens at verify time via
 * `materializeOrderFromIntent`.
 */
export async function createCafePaymentIntent(args: CreateIntentArgs) {
  const expiresAt = new Date(Date.now() + INTENT_TTL_MINUTES * 60 * 1000);
  const normalisedPhone = args.guestPhone
    ? normalizeIndianPhone(args.guestPhone)
    : null;

  return db.cafePaymentIntent.create({
    data: {
      userId: args.userId,
      guestName: args.guestName,
      guestPhone: normalisedPhone,
      note: args.note,
      paymentMethod: args.paymentMethod,
      cart: args.cart as object, // Prisma JSON shape
      totalAmount: args.totalAmount,
      originalAmount: args.originalAmount,
      discountAmount: args.discountAmount,
      discountCodeId: args.discountCodeId,
      expiresAt,
    },
  });
}

export interface MaterializePaymentRef {
  // Razorpay path
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
  // PhonePe path
  phonePeMerchantTxnId?: string;
  phonePeTransactionId?: string | null;
  // Optional overrides — used by the DQR path so the materialised
  // CafePayment records method UPI_QR + confirmedBy "PHONEPE_DQR"
  // even though the intent was created with paymentMethod PHONEPE.
  // Defaults preserve the existing Razorpay/PhonePe-checkout behaviour.
  method?: PaymentMethod;
  confirmedBy?: string | null;
}

export type MaterializeResult =
  | {
      ok: true;
      orderId: string;
      orderNumber: string;
      status: "PENDING" | "COMPLETED";
      allReady: boolean;
    }
  | {
      ok: false;
      error: string;
      // Set when the failure is a sold-out race that landed AFTER
      // payment capture — the customer needs a refund and the
      // operator needs an audit trail, so we materialise a
      // CANCELLED order anyway with the orderId returned here.
      refundOrderId?: string;
    };

/**
 * Materialise a paid intent into a real CafeOrder. This is the
 * SHARED commit step for both Razorpay verify and PhonePe
 * callback/redirect. Steps:
 *
 *   1. Idempotency — if the intent already has consumedOrderId,
 *      return that order.
 *   2. Load the linked CafeItems; refuse if any line is missing or
 *      unavailable.
 *   3. Atomically decrement Ready (non-null quantity) stock with a
 *      `gte` guard. On race-loss, roll back partial decrements and
 *      materialise a CANCELLED order so the refund has an audit
 *      trail.
 *   4. Compute allReady; route to COMPLETED (skip kitchen) or
 *      PENDING (live board picks up).
 *   5. Create CafeOrder + CafeOrderItem + CafePayment in a single
 *      transaction, with the gateway payment ids stamped.
 *   6. Burn the coupon usage (no rollback path — coupon only ever
 *      consumed on a successful order).
 *   7. Mark the intent consumed.
 */
export async function materializeOrderFromIntent(
  intentId: string,
  paymentRef: MaterializePaymentRef,
): Promise<MaterializeResult> {
  const intent = await db.cafePaymentIntent.findUnique({
    where: { id: intentId },
  });
  if (!intent) return { ok: false, error: "Checkout session expired" };

  // Idempotency — duplicate webhook + client verify both firing,
  // or a customer double-submitting. Return the existing order.
  if (intent.consumedOrderId) {
    const existing = await db.cafeOrder.findUnique({
      where: { id: intent.consumedOrderId },
      select: { id: true, orderNumber: true, status: true },
    });
    if (existing) {
      return {
        ok: true,
        orderId: existing.id,
        orderNumber: existing.orderNumber,
        status:
          existing.status === "COMPLETED" ? "COMPLETED" : "PENDING",
        allReady: existing.status === "COMPLETED",
      };
    }
  }

  const cart = intent.cart as unknown as CafeCartLine[];
  if (!Array.isArray(cart) || cart.length === 0) {
    return { ok: false, error: "Cart is empty" };
  }

  const cafeItemIds = cart.map((c) => c.cafeItemId);
  const cafeItems = await db.cafeItem.findMany({
    where: { id: { in: cafeItemIds } },
    select: {
      id: true,
      name: true,
      isAvailable: true,
      quantity: true,
      price: true,
    },
  });

  if (cafeItems.length !== cafeItemIds.length) {
    return { ok: false, error: "One or more items are no longer available" };
  }
  const itemMap = new Map(cafeItems.map((i) => [i.id, i]));

  for (const item of cafeItems) {
    if (!item.isAvailable) {
      return {
        ok: false,
        error: `${item.name} is no longer available`,
      };
    }
  }

  // Atomic stock reservation. We attempt the decrement BEFORE
  // creating the order — if a race loses, the order is never
  // created in the first place. The sole exception is the rare
  // sold-out-after-payment case, where we materialise a CANCELLED
  // order for refund tracking (see below).
  const decremented: Array<{ id: string; quantity: number }> = [];
  for (const line of cart) {
    const item = itemMap.get(line.cafeItemId)!;
    if (item.quantity === null) continue; // Prepare item, unlimited
    const updated = await db.cafeItem.updateMany({
      where: {
        id: line.cafeItemId,
        quantity: { gte: line.quantity },
      },
      data: { quantity: { decrement: line.quantity } },
    });
    if (updated.count === 0) {
      // Roll back what we already took
      for (const rb of decremented) {
        await db.cafeItem.update({
          where: { id: rb.id },
          data: { quantity: { increment: rb.quantity } },
        });
      }
      // Sold-out race AFTER payment capture — customer is owed a
      // refund. We need an audit trail, so create a CANCELLED
      // CafeOrder carrying the captured payment info. This is the
      // ONLY case where a CANCELLED CafeOrder is created on the
      // payment-first flow; normal modal-dismiss never creates a
      // row at all.
      const refundOrder = await createCancelledRefundOrder(
        intent,
        cart,
        itemMap,
        paymentRef,
      );
      return {
        ok: false,
        error: `${item.name} sold out before we could confirm your order. Your payment will be refunded.`,
        refundOrderId: refundOrder.id,
      };
    }
    decremented.push({ id: line.cafeItemId, quantity: line.quantity });
  }

  // Ready vs Prepare routing — all lines Ready means counter
  // hand-off; skip the kitchen pipeline.
  const allReady = cart.every(
    (line) => itemMap.get(line.cafeItemId)?.quantity !== null,
  );
  const nextStatus: "PENDING" | "COMPLETED" = allReady ? "COMPLETED" : "PENDING";

  const orderNumber = await generateCafeOrderNumber();

  const orderItemsData = cart.map((line) => {
    const item = itemMap.get(line.cafeItemId)!;
    return {
      cafeItemId: line.cafeItemId,
      itemName: item.name,
      quantity: line.quantity,
      unitPrice: item.price,
      totalPrice: item.price * line.quantity,
    };
  });

  const order = await db.$transaction(async (tx) => {
    const created = await tx.cafeOrder.create({
      data: {
        orderNumber,
        userId: intent.userId,
        guestName: intent.userId ? null : intent.guestName ?? "Guest",
        guestPhone: intent.userId ? null : intent.guestPhone,
        status: nextStatus,
        totalAmount: intent.totalAmount,
        originalAmount: intent.originalAmount,
        discountAmount: intent.discountAmount,
        discountCodeId: intent.discountCodeId,
        note: intent.note,
        items: { create: orderItemsData },
        payment: {
          create: {
            method: paymentRef.method ?? intent.paymentMethod,
            status: "COMPLETED",
            amount: intent.totalAmount,
            razorpayOrderId: paymentRef.razorpayOrderId ?? null,
            razorpayPaymentId: paymentRef.razorpayPaymentId ?? null,
            razorpaySignature: paymentRef.razorpaySignature ?? null,
            phonePeMerchantTxnId: paymentRef.phonePeMerchantTxnId ?? null,
            phonePeTransactionId: paymentRef.phonePeTransactionId ?? null,
            confirmedBy: paymentRef.confirmedBy ?? null,
            confirmedAt: new Date(),
          },
        },
      },
    });

    // Burn the coupon usage now that the order has actually
    // landed. The OLD flow burned it at intent-create time, which
    // required rollback on cancel; deferring to here means no
    // rollback path is needed.
    if (intent.discountCodeId && intent.discountAmount > 0) {
      await tx.cafeDiscount.update({
        where: { id: intent.discountCodeId },
        data: { usedCount: { increment: 1 } },
      });
    }

    // Mark the intent consumed so duplicate verify callbacks
    // become idempotent no-ops (see top of this function).
    await tx.cafePaymentIntent.update({
      where: { id: intent.id },
      data: {
        consumedAt: new Date(),
        consumedOrderId: created.id,
      },
    });

    return created;
  });

  // Parity with the admin status-transition path (admin-cafe-orders.ts): an
  // order that materializes DIRECTLY into COMPLETED (all items ready, no
  // kitchen step) still earns cafe reward points. PENDING orders earn later
  // when an admin flips them to COMPLETED. Idempotent + fire-and-forget.
  if (nextStatus === "COMPLETED" && intent.userId) {
    const { awardCafePoints } = await import("@/lib/rewards/earn");
    void awardCafePoints(order.id).catch((err) =>
      console.error("[rewards] cafe award failed for", order.id, err),
    );
  }

  return {
    ok: true,
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: nextStatus,
    allReady,
  };
}

/**
 * Delete a checkout intent that the customer abandoned (Razorpay
 * modal dismiss, PhonePe failure redirect, etc). No CafeOrder
 * exists at this point, so there's nothing to cancel — just drop
 * the intent so it doesn't linger.
 *
 * Idempotent: tolerates a missing row (sweeper or duplicate cancel
 * may have already taken it).
 */
export async function deleteCafePaymentIntent(intentId: string): Promise<void> {
  try {
    await db.cafePaymentIntent.delete({ where: { id: intentId } });
  } catch {
    // Already gone — no-op.
  }
}

// ─────────── helpers ───────────

async function generateCafeOrderNumber(): Promise<string> {
  const orderCount = await db.cafeOrder.count();
  const rand = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `MA-CAFE-${String(orderCount + 1).padStart(4, "0")}-${rand}`;
}

async function createCancelledRefundOrder(
  intent: { id: string; userId: string | null; guestName: string | null; guestPhone: string | null; note: string | null; paymentMethod: PaymentMethod; totalAmount: number; originalAmount: number; discountAmount: number; discountCodeId: string | null },
  cart: CafeCartLine[],
  itemMap: Map<string, { id: string; name: string; price: number }>,
  paymentRef: MaterializePaymentRef,
) {
  const orderNumber = await generateCafeOrderNumber();
  const orderItemsData = cart.map((line) => {
    const item = itemMap.get(line.cafeItemId)!;
    return {
      cafeItemId: line.cafeItemId,
      itemName: item.name,
      quantity: line.quantity,
      unitPrice: item.price,
      totalPrice: item.price * line.quantity,
    };
  });

  const order = await db.$transaction(async (tx) => {
    const created = await tx.cafeOrder.create({
      data: {
        orderNumber,
        userId: intent.userId,
        guestName: intent.userId ? null : intent.guestName ?? "Guest",
        guestPhone: intent.userId ? null : intent.guestPhone,
        status: "CANCELLED",
        totalAmount: intent.totalAmount,
        originalAmount: intent.originalAmount,
        discountAmount: intent.discountAmount,
        discountCodeId: intent.discountCodeId,
        note: intent.note
          ? `${intent.note} — auto-cancelled (sold out after payment, refund required)`
          : "Auto-cancelled (sold out after payment, refund required)",
        items: { create: orderItemsData },
        payment: {
          create: {
            method: paymentRef.method ?? intent.paymentMethod,
            status: "COMPLETED",
            amount: intent.totalAmount,
            razorpayOrderId: paymentRef.razorpayOrderId ?? null,
            razorpayPaymentId: paymentRef.razorpayPaymentId ?? null,
            razorpaySignature: paymentRef.razorpaySignature ?? null,
            phonePeMerchantTxnId: paymentRef.phonePeMerchantTxnId ?? null,
            phonePeTransactionId: paymentRef.phonePeTransactionId ?? null,
            confirmedBy: paymentRef.confirmedBy ?? null,
            confirmedAt: new Date(),
            refundReason: "Sold out after payment capture",
          },
        },
      },
    });
    await tx.cafePaymentIntent.update({
      where: { id: intent.id },
      data: {
        consumedAt: new Date(),
        consumedOrderId: created.id,
      },
    });
    return created;
  });
  return order;
}
