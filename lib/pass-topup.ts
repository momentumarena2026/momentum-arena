import { after } from "next/server";
import type { CourtConfig, SlotHold } from "@prisma/client";
import { db } from "@/lib/db";
import { createBookingFromHold } from "@/actions/booking";
import { getPassOfferForHold, debitPass } from "@/lib/passes";
import { fetchRazorpayOrder } from "@/lib/razorpay";
import { recordOrphanPayment } from "@/lib/payment-orphan";
import {
  sendBookingConfirmation,
  notifyAdminBookingConfirmed,
} from "@/lib/notifications";

export type PassTopupResult =
  | { ok: true; bookingId: string; alreadyDone: boolean }
  | { ok: false; status: number; error: string };

/**
 * Complete a pass top-up after Razorpay captured the remainder order —
 * create the booking, debit the covered minutes, fan out confirmations.
 * Shared by the client's /api/passes/redeem-verify and the
 * payment.captured webhook so the Booking + PassRedemption land
 * identically whichever path wins the race. Callers have already
 * authenticated the event (client signature / webhook HMAC) and checked
 * the hold belongs to the paying user; the hold may be EXPIRED — an
 * order stamped on it keeps it recoverable for the 24h grace window
 * (see cleanupExpiredHolds) and createBookingFromHold re-checks slot
 * conflicts.
 *
 * Money rules:
 *  - Payment.amount = the ORDER's amount (money actually captured),
 *    never a verify-time recompute.
 *  - The offer is recomputed for minutes/coverage only; if its remainder
 *    no longer matches the captured amount (pass balance moved since the
 *    modal opened), the booking is NOT created and the captured payment
 *    goes to the orphan worklist for an admin to honour or refund.
 */
export async function completePassTopup(args: {
  hold: SlotHold & { courtConfig: CourtConfig };
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
  path?: string;
}): Promise<PassTopupResult> {
  const { hold } = args;

  // Idempotency — the other path (client verify vs webhook) already won.
  const existing = await db.payment.findFirst({
    where: { razorpayPaymentId: args.razorpayPaymentId },
    select: { bookingId: true },
  });
  if (existing) {
    return { ok: true, bookingId: existing.bookingId, alreadyDone: true };
  }

  if (!hold.redeemPassId) {
    return { ok: false, status: 409, error: "Hold has no pass attached" };
  }
  // The captured order must be the one minted FOR this hold — a valid
  // signature for some other (cheaper) order must not complete it.
  if (!hold.razorpayOrderId || hold.razorpayOrderId !== args.razorpayOrderId) {
    return { ok: false, status: 400, error: "Order mismatch" };
  }

  let orderAmountRupees: number;
  try {
    const order = await fetchRazorpayOrder(args.razorpayOrderId);
    orderAmountRupees = Math.round(order.amount / 100); // paise → rupees
  } catch (err) {
    console.error("[pass-topup] order fetch failed", args.razorpayOrderId, err);
    return {
      ok: false,
      status: 502,
      error: "Couldn't confirm the payment with Razorpay — please retry",
    };
  }

  const orphan = (reason: "no-hold" | "slot-taken" | "create-failed") =>
    recordOrphanPayment({
      gateway: "RAZORPAY",
      reason,
      userId: hold.userId,
      amountRupees: orderAmountRupees,
      razorpayOrderId: args.razorpayOrderId,
      razorpayPaymentId: args.razorpayPaymentId,
      holdId: hold.id,
      path: args.path,
    });

  // Server-side recompute — never trust client coverage numbers. Scoped
  // to the pass the customer COMMITTED to (buying a second pass mid-
  // payment must not invalidate this one), and judged coupon-free
  // because the remainder order was priced that way.
  const offer = await getPassOfferForHold(
    { ...hold, couponId: null, pointsToRedeem: null },
    { onlyPassId: hold.redeemPassId },
  );
  // If the pass moved and the remainder no longer equals what was
  // captured, refuse to build a booking around the stale split.
  if (
    !offer ||
    offer.passId !== hold.redeemPassId ||
    offer.fullCoverage ||
    offer.remainderAmount !== orderAmountRupees
  ) {
    orphan("create-failed");
    return {
      ok: false,
      status: 409,
      error:
        "Payment received, but the pass balance changed while you paid. Please do NOT pay again — our team will confirm your booking or refund you shortly.",
    };
  }

  // Passes don't combine with coupons/points (v1) and the captured
  // remainder was priced without them — strip now, at the last possible
  // moment, so an abandoned top-up never costs the customer a discount
  // they could still have used on the normal payment path.
  const hadDiscounts = !!hold.couponId || (hold.pointsToRedeem ?? 0) > 0;
  if (hadDiscounts) {
    await db.slotHold.update({
      where: { id: hold.id },
      data: {
        couponId: null,
        discountAmount: null,
        pointsToRedeem: null,
        pointsRedeemPaiseSaved: null,
      },
    });
  }
  /** Put the discount back if no booking came of this — the hold may
   *  still be used on the normal payment path, and the strip is a
   *  separate write from the booking transaction. */
  const restoreDiscounts = async () => {
    if (!hadDiscounts) return;
    await db.slotHold
      .updateMany({
        where: { id: hold.id },
        data: {
          couponId: hold.couponId,
          discountAmount: hold.discountAmount,
          pointsToRedeem: hold.pointsToRedeem,
          pointsRedeemPaiseSaved: hold.pointsRedeemPaiseSaved,
        },
      })
      .catch(() => {});
  };

  let bookingId: string | null = null;
  try {
    bookingId = await createBookingFromHold(
      hold.id,
      {
        method: "RAZORPAY",
        status: "COMPLETED",
        amount: orderAmountRupees,
        razorpayOrderId: args.razorpayOrderId,
        razorpayPaymentId: args.razorpayPaymentId,
        razorpaySignature: args.razorpaySignature,
        confirmedAt: new Date(),
        confirmedBy: "PASS_TOPUP",
      },
      "CONFIRMED",
    );
  } catch (err) {
    // Slot re-booked while the payment was in flight (the tx rolled the
    // hold back) or creation failed outright — money is captured either
    // way, so make it loud. createBookingFromHold records its own
    // orphan for the SLOT_CONFLICT case it swallows; this catch only
    // sees the ones it rethrows.
    console.error("[pass-topup] createBookingFromHold failed", err);
    await restoreDiscounts();
    orphan("create-failed");
    return {
      ok: false,
      status: 409,
      error:
        "Payment received, but the slot was taken while you paid. Please do NOT pay again — our team will confirm your booking or refund you shortly.",
    };
  }
  if (!bookingId) {
    // The other path (client verify vs webhook) may simply have won the
    // race and consumed the hold — that's a success, not a lost payment.
    const raced = await db.payment.findFirst({
      where: { razorpayPaymentId: args.razorpayPaymentId },
      select: { bookingId: true },
    });
    if (raced) {
      return { ok: true, bookingId: raced.bookingId, alreadyDone: true };
    }
    // Genuinely lost. createBookingFromHold records its own orphan ONLY
    // for the slot-conflict case it swallows; its other two null
    // returns (hold vanished between our read and its re-read, or the
    // consuming delete matched nothing) record nothing — so captured
    // money would disappear from the worklist entirely. If the hold is
    // gone and no orphan came from inside, file one here.
    const holdStillThere = await db.slotHold.findUnique({
      where: { id: hold.id },
      select: { id: true },
    });
    if (holdStillThere) await restoreDiscounts();
    else orphan("no-hold");
    return {
      ok: false,
      status: 410,
      error:
        "Payment received, but your slot reservation had expired. Please do NOT pay again — our team will confirm your booking or refund you shortly.",
    };
  }

  // The pass settles everything the gateway remainder didn't cover. A
  // false return leaves no redemption row, so the covered hours simply
  // surface as owed-at-venue instead of being silently written off.
  const ok = await debitPass(
    offer.passId,
    offer.coveredMinutes,
    bookingId,
    // The court time the pass covered — not total − captured, which
    // would fold equipment into the pass's share.
    offer.coveredAmount,
  );
  if (!ok) {
    console.error("[pass-topup] debit failed post-booking", bookingId);
  }

  // Same confirmation fan-out as every money path.
  const confirmedBookingId = bookingId;
  after(async () => {
    await Promise.allSettled([
      sendBookingConfirmation(confirmedBookingId).catch((err) =>
        console.error("[pass-topup] booking confirmation failed", err),
      ),
      notifyAdminBookingConfirmed(confirmedBookingId).catch((err) =>
        console.error("[pass-topup] admin notify failed", err),
      ),
    ]);
  });
  return { ok: true, bookingId, alreadyDone: false };
}
