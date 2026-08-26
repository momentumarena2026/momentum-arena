import { remainderAfterAdvance } from "@/lib/booking-amounts";
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
    select: { id: true, bookingId: true, status: true },
  });
  if (existing && existing.status === "COMPLETED") {
    return { bookingId: existing.bookingId, alreadyDone: true };
  }
  if (existing) {
    // A PENDING payment on this txn is the customer's own "I've paid"
    // claim: we reserved their slot as an unconfirmed booking while
    // PhonePe hadn't reported the money yet. PhonePe has now reported
    // it, so settle the claim automatically — the admin never has to
    // verify a payment the gateway itself just confirmed.
    await db.$transaction([
      db.payment.update({
        where: { id: existing.id },
        data: {
          status: "COMPLETED",
          confirmedAt: new Date(),
          confirmedBy: "PHONEPE_DQR",
          ...(providerReferenceId
            ? { phonePeTransactionId: providerReferenceId }
            : {}),
        },
      }),
      db.booking.update({
        where: { id: existing.bookingId },
        data: { status: "CONFIRMED" },
      }),
    ]);
    console.log(
      `[dqr] late settlement confirmed claimed booking ${existing.bookingId} (txn ${transactionId})`,
    );
    after(async () => {
      await Promise.allSettled([
        sendBookingConfirmation(existing.bookingId).catch(() => {}),
        notifyAdminBookingConfirmed(existing.bookingId).catch(() => {}),
        // Late-settled "I've paid" bookings earn points too — same as the
        // fresh-booking branch below. awardBookingPoints is idempotent
        // (@@unique[type,bookingId]) and earns on Payment.amount only.
        awardBookingPoints(existing.bookingId).catch((err) =>
          console.error("[dqr] rewards award failed", existing.bookingId, err),
        ),
      ]);
    });
    return { bookingId: existing.bookingId, alreadyDone: false };
  }

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
  // Gear picked at lock time is PLUSed on top of the slot total — the same
  // `effectiveTotal` math createBookingFromHold uses for Booking.totalAmount.
  // Leaving it out understated remainingAmount by the equipment total, so
  // the venue was told to collect less than markRemainderCollected demands.
  const fullAmount =
    hold.totalAmount -
    appliedDiscount -
    pointsRedeemRupees +
    (hold.equipmentTotalAmount ?? 0);
  const advanceAmount = isAdvance ? paymentAmount : undefined;
  const remainingAmount = isAdvance
    ? remainderAfterAdvance(fullAmount, paymentAmount)
    : undefined;

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
