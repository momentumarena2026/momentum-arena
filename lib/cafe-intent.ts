import { after } from "next/server";

import { db } from "./db";
import { normalizeIndianPhone } from "./phone";
import type { CafeOrderStatus, PaymentMethod, Prisma } from "@prisma/client";

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

/**
 * Thrown by `burnCafeCoupon` when a coupon's global or per-user cap is
 * already exhausted at commit time. Only ever raised on pre-payment
 * paths (`enforceLimits: true`) — see the helper's docs.
 */
export class CafeCouponLimitError extends Error {}

/**
 * Claim one use of a cafe coupon inside an order transaction.
 *
 * Both writes must happen together or the caps are meaningless:
 * `CafeDiscount.usedCount` moves AND a `CafeDiscountUsage` ledger row
 * is written. `validateCafeCoupon` enforces maxUsesPerUser by counting
 * those rows, so an increment without the row leaves the per-user
 * limit permanently bypassable. Guests have no account to meter
 * against, so they only move the counter.
 *
 * `enforceLimits` splits the two kinds of caller:
 *   - true — nothing has been charged yet (in-person orders). The
 *     increment is conditional (same claim pattern as the booking
 *     coupon in actions/booking.ts) so two concurrent submits can't
 *     both slip past the cap; on failure we throw and the caller's
 *     transaction rolls the order back.
 *   - false — the payment is already captured (materialised online
 *     orders). Refusing here would strand the customer's money, so the
 *     usage is recorded unconditionally and the cap may overshoot by
 *     the checkouts that were already in flight.
 */
export async function burnCafeCoupon(
  tx: Prisma.TransactionClient,
  args: {
    discountId: string;
    userId: string | null;
    orderId: string;
    discountAmount: number;
    enforceLimits: boolean;
  },
): Promise<void> {
  const discount = await tx.cafeDiscount.findUnique({
    where: { id: args.discountId },
    select: { maxUses: true, maxUsesPerUser: true },
  });
  if (!discount) {
    if (!args.enforceLimits) return;
    throw new CafeCouponLimitError("Coupon is no longer available");
  }

  // Conditional increment: Postgres re-evaluates the WHERE clause once
  // the concurrent writer's row lock is released, so the global cap
  // holds even when two orders commit at the same instant. It also
  // serialises the per-user recount below onto this same coupon row.
  const claimed = await tx.cafeDiscount.updateMany({
    where: {
      id: args.discountId,
      ...(args.enforceLimits && discount.maxUses !== null
        ? { usedCount: { lt: discount.maxUses } }
        : {}),
    },
    data: { usedCount: { increment: 1 } },
  });
  if (claimed.count === 0) {
    if (!args.enforceLimits) return;
    throw new CafeCouponLimitError("Coupon usage limit reached");
  }

  // Guest order — no user to meter, so no ledger row.
  if (!args.userId) return;

  if (args.enforceLimits) {
    const priorUserUsage = await tx.cafeDiscountUsage.count({
      where: { discountId: args.discountId, userId: args.userId },
    });
    if (priorUserUsage >= discount.maxUsesPerUser) {
      throw new CafeCouponLimitError("You have already used this coupon");
    }
  }

  await tx.cafeDiscountUsage.create({
    data: {
      discountId: args.discountId,
      userId: args.userId,
      orderId: args.orderId,
      discountAmount: args.discountAmount,
    },
  });
}

/**
 * Give a cafe coupon claim back when an order is cancelled — the exact
 * counterpart to `burnCafeCoupon`, shared by every path that flips a
 * CafeOrder to CANCELLED (admin cancel, UTR reject, UTR expiry).
 *
 * Nothing cascades off `CafeDiscountUsage.orderId`, so without this a
 * cancelled order keeps consuming the customer's per-user slot forever
 * (`validateCafeCoupon` counts those rows) and leaves the global
 * `usedCount` inflated.
 *
 * No-ops when there is nothing to give back: PENDING_PAYMENT orders never
 * burned a coupon (that happens at materialise time), and an order already
 * CANCELLED was released by whoever cancelled it first — the guard keeps
 * repeat cancels from decrementing `usedCount` more than once.
 */
export async function releaseCafeCoupon(
  tx: Prisma.TransactionClient,
  order: {
    id: string;
    status: CafeOrderStatus;
    discountCodeId: string | null;
    discountAmount: number;
  },
): Promise<void> {
  if (order.status === "PENDING_PAYMENT" || order.status === "CANCELLED") return;
  if (!order.discountCodeId || order.discountAmount <= 0) return;

  await tx.cafeDiscountUsage.deleteMany({ where: { orderId: order.id } });
  // Guarded so a coupon whose counter was never incremented can't be
  // driven negative.
  await tx.cafeDiscount.updateMany({
    where: { id: order.discountCodeId, usedCount: { gt: 0 } },
    data: { usedCount: { decrement: 1 } },
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
      // enforceLimits: false — the gateway has already captured the
      // money, so a cap that filled up mid-checkout must not roll the
      // paid order back.
      await burnCafeCoupon(tx, {
        discountId: intent.discountCodeId,
        userId: intent.userId,
        orderId: created.id,
        discountAmount: intent.discountAmount,
        enforceLimits: false,
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
  // when an admin flips them to COMPLETED. Idempotent at the lib layer, and
  // scheduled on the request's after() window (same pattern as
  // lib/dqr-confirm) — a bare fire-and-forget promise is killed when the
  // gateway callback returns and the points are lost with nothing to retry.
  if (nextStatus === "COMPLETED" && intent.userId) {
    after(async () => {
      const { awardCafePoints } = await import("@/lib/rewards/earn");
      await awardCafePoints(order.id).catch((err) =>
        console.error("[rewards] cafe award failed for", order.id, err),
      );
    });
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
