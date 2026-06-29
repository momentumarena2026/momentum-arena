import { after } from "next/server";
import { db } from "@/lib/db";
import { createBookingFromHold } from "@/actions/booking";
import {
  sendBookingConfirmation,
  notifyAdminBookingConfirmed,
} from "@/lib/notifications";
import { awardBookingPoints } from "@/lib/rewards/earn";
import { materializeOrderFromIntent } from "@/lib/cafe-intent";
import { DQR_CONFIRMED_BY } from "@/lib/phonepe-dqr";
import { recordOrphanPayment } from "@/lib/payment-orphan";

/**
 * Shared "DQR payment settled → materialise the order" commit step,
 * called by BOTH the client status poll (`/api/phonepe/dqr/status*`)
 * and the authoritative S2S callback (`/api/phonepe/dqr-callback`).
 * Either path may win the race; both are idempotent.
 *
 * Mirrors the amount math + notification dispatch of the existing
 * PhonePe-checkout handlers (callback/redirect routes). DQR
 * transactionId is stored on the hold/intent's `phonePeMerchantTxnId`
 * column, so we look up by that.
 */

export interface DqrBookingResult {
  bookingId: string | null;
  alreadyDone: boolean;
}

/** Confirm a sports-booking DQR payment by its transactionId. */
export async function confirmDqrBooking(
  transactionId: string,
  providerReferenceId?: string,
): Promise<DqrBookingResult> {
  // Idempotency — callback + poll both fire; if the Payment already
  // exists this transaction is done.
  const existing = await db.payment.findFirst({
    where: { phonePeMerchantTxnId: transactionId },
    select: { bookingId: true },
  });
  if (existing) return { bookingId: existing.bookingId, alreadyDone: true };

  const hold = await db.slotHold.findUnique({
    where: { phonePeMerchantTxnId: transactionId },
  });
  if (!hold) {
    // This commit step only runs once PhonePe reports the DQR payment
    // COMPLETED, so money is captured. A missing hold means the blueprint
    // was swept (past the 24h grace) with no booking — an orphan. Record it
    // for admin recovery/refund instead of silently returning null.
    recordOrphanPayment({
      gateway: "PHONEPE_DQR",
      reason: "no-hold",
      phonePeMerchantTxnId: transactionId,
    });
    return { bookingId: null, alreadyDone: false };
  }

  // Amount math identical to phonepe/callback + redirect: hold amounts
  // are rupees; advance is flagged by paymentMethod === "CASH"; the
  // "full" figure is post-discount (coupon + points) so the venue is
  // never told to collect the discount back.
  const paymentAmount = hold.paymentAmount ?? hold.totalAmount;
  const isAdvance = hold.paymentMethod === "CASH";
  const appliedDiscount =
    hold.couponId && hold.discountAmount && hold.discountAmount > 0
      ? hold.discountAmount
      : 0;
  const pointsRedeemRupees =
    hold.pointsToRedeem && hold.pointsRedeemPaiseSaved
      ? Math.floor(hold.pointsRedeemPaiseSaved / 100)
      : 0;
  const fullAmount = hold.totalAmount - appliedDiscount - pointsRedeemRupees;
  const advanceAmount = isAdvance ? paymentAmount : undefined;
  const remainingAmount = isAdvance ? fullAmount - paymentAmount : undefined;

  const bookingId = await createBookingFromHold(
    hold.id,
    {
      method: "UPI_QR",
      status: isAdvance ? "PARTIAL" : "COMPLETED",
      amount: paymentAmount,
      phonePeMerchantTxnId: transactionId,
      phonePeTransactionId: providerReferenceId,
      confirmedAt: new Date(),
      confirmedBy: DQR_CONFIRMED_BY,
      isPartialPayment: isAdvance,
      advanceAmount,
      remainingAmount,
    },
    "CONFIRMED",
  );

  if (!bookingId) {
    // Race: the other path consumed the hold first. Re-read the Payment.
    const p = await db.payment.findFirst({
      where: { phonePeMerchantTxnId: transactionId },
      select: { bookingId: true },
    });
    return { bookingId: p?.bookingId ?? null, alreadyDone: true };
  }

  // Notifications + rewards ride the request's after() window so the
  // serverless function stays alive (same pattern as the gateway
  // callback). awardBookingPoints is idempotent + self-gated.
  after(async () => {
    await Promise.allSettled([
      sendBookingConfirmation(bookingId).catch((err) =>
        console.error("[dqr] booking confirmation SMS failed", err),
      ),
      notifyAdminBookingConfirmed(bookingId).catch((err) =>
        console.error("[dqr] admin notify failed", err),
      ),
      awardBookingPoints(bookingId).catch((err) =>
        console.error("[dqr] rewards award failed", bookingId, err),
      ),
    ]);
  });

  return { bookingId, alreadyDone: false };
}

export interface DqrCafeResult {
  orderId: string | null;
  alreadyDone: boolean;
  error?: string;
}

/** Confirm a cafe DQR payment by its transactionId (intent-based). */
export async function confirmDqrCafe(
  transactionId: string,
  providerReferenceId?: string,
): Promise<DqrCafeResult> {
  const intent = await db.cafePaymentIntent.findUnique({
    where: { phonePeMerchantTxnId: transactionId },
    select: { id: true, consumedOrderId: true },
  });
  if (!intent) return { orderId: null, alreadyDone: false };
  if (intent.consumedOrderId) {
    return { orderId: intent.consumedOrderId, alreadyDone: true };
  }

  const result = await materializeOrderFromIntent(intent.id, {
    phonePeMerchantTxnId: transactionId,
    phonePeTransactionId: providerReferenceId ?? null,
    // Record this as a UPI QR payment confirmed by DQR, distinct from
    // the PhonePe-checkout (gateway) flow.
    method: "UPI_QR",
    confirmedBy: DQR_CONFIRMED_BY,
  });

  if (result.ok) return { orderId: result.orderId, alreadyDone: false };
  // Sold-out-after-capture: a CANCELLED refund order was materialised.
  return {
    orderId: result.refundOrderId ?? null,
    alreadyDone: false,
    error: result.error,
  };
}
