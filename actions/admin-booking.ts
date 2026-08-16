"use server";

import { after } from "next/server";
import { notifyBookingActivity } from "@/lib/booking-activity";

import { db } from "@/lib/db";
// Type-only — the runtime helper stays behind the existing dynamic
// import()s at the bowling call sites.
import type { BowlingSlot } from "@/lib/bowling-availability";
import { completePassTopup } from "@/lib/pass-topup";
import { qrStatus } from "@/lib/phonepe-dqr";
import { confirmDqrBooking, confirmDqrCafe } from "@/lib/dqr-confirm";
import {
  recomputePartialPaymentAmounts,
  venueCollected,
} from "@/lib/payment-split";
import {
  restorePassForBooking,
  passMinutesValue,
  getPassOfferForHold,
  debitPass,
  syncPassAfterAdminEdit,
  passCoversCourtGroup,
  passBandsCoverHours,
  parseCoveredSlots,
  adoptLegacyCoverage,
  confirmDqrPass,
  shouldCoverDelta,
} from "@/lib/passes";
import {
  sendBookingConfirmation,
  notifyAdminBookingConfirmed,
  notifyAdminBookingCancelled,
} from "@/lib/notifications";
import { requireAdmin as requireAdminBase } from "@/lib/admin-auth";
import { normalizeIndianPhone } from "@/lib/phone";
import { sendTemplatedToUser } from "@/lib/push-templates";
import { formatHoursAsRanges } from "@/lib/court-config";
import { notifyWaitlistersForFreedSlots } from "@/actions/waitlist";
import {
  awardBookingPoints,
  awardBookingRemainderPoints,
  previewBookingEarn,
} from "@/lib/rewards/earn";
import { revokeBookingRewards } from "@/lib/rewards/revoke";
import { getRewardConfig, pointsToPaise } from "@/lib/rewards/config";
import { ensureBalance, applyBalanceDelta } from "@/lib/rewards/balance";
import { getActiveSportPromo } from "@/actions/sport-promo";
import { computeAutoApplyDiscount } from "@/lib/auto-apply-promo";
import {
  fetchRazorpayPayment,
  type RazorpayPaymentRecord,
} from "@/lib/razorpay";
import { createBookingFromHold as _createBookingFromHold } from "@/actions/booking";

async function requireAdmin() {
  const user = await requireAdminBase("MANAGE_BOOKINGS");
  return user.id;
}

// Which bookings block an hour from being SOLD at the admin counter.
// PENDING/CONFIRMED are obvious; COMPLETED is included because the front
// desk often closes a session out while it is still running, and dropping
// it would put an occupied court back on sale.
//
// ABSENT is deliberately NOT here, and this list therefore does NOT match
// its namesakes in lib/availability.ts (customer-facing sale) or
// actions/admin-calendar.ts (cell rendering) — do not "align" them. A
// no-show's court is empty, and the counter must be able to re-sell it;
// the only alternative is cancelling the booking, which would also throw
// away the forfeited advance the venue is entitled to keep. The calendar
// still renders the ABSENT pill, so the double-booked cell is explained.
//
// The bowling machine's 30-min grid doesn't query bookings here — it
// goes through lib/bowling-availability.ts, which uses the customer
// rule. reopenNoShowBowlingSlots below re-applies this one on top of
// that result so both admin surfaces re-sell no-shows the same way.
const OCCUPYING_BOOKING_STATUSES = [
  "CONFIRMED",
  "PENDING",
  "COMPLETED",
] as const;

// Same idea for the money: a closed-out booking keeps the advance as
// earnings, so it must stay in the revenue/count KPIs it was in while
// CONFIRMED — otherwise the dashboard drifts below actual takings every
// time the front desk uses the closeout buttons. Note this widens the
// "Total Bookings" tile from CONFIRMED-only to "every booking that
// stood": no-shows are counted, matching the revenue they contribute
// (closeOutBooking writes the uncollected remainder off the total, so
// the two tiles stay in step).
const EARNING_BOOKING_STATUSES = ["CONFIRMED", "COMPLETED", "ABSENT"] as const;

/**
 * Bust the App Router cache for every page that renders the booking
 * row(s) we just touched. Web form-action callers used to get this
 * for free (they re-render after the action), but mobile API routes
 * call these functions over JWT and never trigger a re-render — so
 * without this the web admin / customer pages would keep showing the
 * pre-mutation snapshot until the user manually refreshes.
 *
 * Wrapped in try/catch so unit tests / non-Next contexts that import
 * the action don't break.
 */
async function revalidateBookingPaths(bookingId?: string) {
  try {
    const { revalidatePath } = await import("next/cache");
    if (bookingId) revalidatePath(`/admin/bookings/${bookingId}`);
    revalidatePath("/admin/bookings");
    revalidatePath("/admin/bookings/unconfirmed");
    revalidatePath("/admin/bookings/calendar");
  } catch {
    /* outside Next.js — fine */
  }
}

// `requireAdmin()` resolves the caller from EITHER the web cookie
// session or the mobile Bearer JWT (see lib/admin-auth.ts), so the
// mobile-admin API routes reuse this action unchanged — no caller-
// supplied identity, which would be client-controlled input on a
// public server-action endpoint.
export async function confirmCashPayment(bookingId: string) {
  const adminId = await requireAdmin();

  const payment = await db.payment.findUnique({
    where: { bookingId },
  });

  if (!payment || payment.method !== "CASH") {
    return { success: false, error: "Cash payment not found" };
  }

  // Partial bookings land on PARTIAL (advance verified, remainder still
  // owed at venue); full bookings go straight to COMPLETED.
  const nextStatus = payment.isPartialPayment ? "PARTIAL" : "COMPLETED";

  await db.$transaction([
    db.payment.update({
      where: { id: payment.id },
      data: {
        status: nextStatus,
        confirmedBy: adminId,
        confirmedAt: new Date(),
      },
    }),
    db.booking.update({
      where: { id: bookingId },
      data: { status: "CONFIRMED" },
    }),
  ]);

  // Send booking confirmation to the customer + ping admins
  await sendBookingConfirmation(bookingId);
  // after(): a bare fire-and-forget is killed when the function freezes.
  after(async () => {
    await Promise.allSettled([
      notifyAdminBookingConfirmed(bookingId).catch((err) =>
        console.error("[notify] admin confirmed failed", err),
      ),
      // Award reward points (idempotent — safe to re-run on retries).
      // Nothing re-invokes this, so losing it to the freeze loses the
      // customer's points permanently.
      awardBookingPoints(bookingId).catch((err) =>
        console.error("[rewards] award failed for", bookingId, err),
      ),
    ]);
  });

  await revalidateBookingPaths(bookingId);

  return { success: true };
}

export async function confirmUpiPayment(bookingId: string) {
  const adminId = await requireAdmin();

  const payment = await db.payment.findUnique({
    where: { bookingId },
    include: { booking: true },
  });

  if (!payment || payment.method !== "UPI_QR") {
    return { success: false, error: "UPI payment not found" };
  }

  const nextStatus = payment.isPartialPayment ? "PARTIAL" : "COMPLETED";

  await db.$transaction([
    db.payment.update({
      where: { id: payment.id },
      data: {
        status: nextStatus,
        confirmedBy: adminId,
        confirmedAt: new Date(),
      },
    }),
    db.booking.update({
      where: { id: bookingId },
      data: { status: "CONFIRMED" },
    }),
  ]);

  // Send booking confirmation to the customer + ping admins
  await sendBookingConfirmation(bookingId);
  // after(): a bare fire-and-forget is killed when the function freezes.
  after(async () => {
    await Promise.allSettled([
      notifyAdminBookingConfirmed(bookingId).catch((err) =>
        console.error("[notify] admin confirmed failed", err),
      ),
      // Award reward points (idempotent — safe to re-run on retries).
      // Nothing re-invokes this, so losing it to the freeze loses the
      // customer's points permanently.
      awardBookingPoints(bookingId).catch((err) =>
        console.error("[rewards] award failed for", bookingId, err),
      ),
    ]);
  });

  await revalidateBookingPaths(bookingId);

  return { success: true };
}

/**
 * Manually flip a PENDING booking to CONFIRMED. The escape hatch
 * for stuck states the regular flows can't reach — e.g. a UPI QR
 * partial whose advance was approved but the status flip didn't
 * fire, or a booking marked-collected directly without going
 * through confirmUpiPayment first.
 *
 * Unlike confirmCashPayment / confirmUpiPayment, this is NOT gated
 * by Payment.method; it just rescues the booking row. The Payment
 * row is left alone — its status is whatever it already is.
 *
 * Fires the same customer SMS/push (sendBookingConfirmation) +
 * admin push (notifyAdminBookingConfirmed) that the gateway-
 * specific paths fire, so customers learn about the confirmation
 * the same way regardless of which path got them there.
 */
export async function confirmBookingManually(bookingId: string) {
  await requireAdmin();

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, status: true },
  });
  if (!booking) {
    return { success: false as const, error: "Booking not found" };
  }
  if (booking.status === "CONFIRMED") {
    return { success: false as const, error: "Already confirmed" };
  }
  if (booking.status === "CANCELLED") {
    return {
      success: false as const,
      error: "Cancelled bookings can't be re-confirmed",
    };
  }

  await db.booking.update({
    where: { id: bookingId },
    data: { status: "CONFIRMED" },
  });

  await sendBookingConfirmation(bookingId);
  after(async () => {
    await Promise.allSettled([
      notifyAdminBookingConfirmed(bookingId).catch((err) =>
        console.error("[notify] admin confirmed failed", err),
      ),
      awardBookingPoints(bookingId).catch((err) =>
        console.error("[rewards] award failed for", bookingId, err),
      ),
    ]);
  });

  await revalidateBookingPaths(bookingId);

  return { success: true as const };
}

// Describe how the remainder was actually collected at the venue: the
// amount paid in cash, the amount paid via UPI QR, and any goodwill
// discount the floor staff applied at collection time. The three legs
// can be zero individually but their sum must equal the remainder
// owed, and at least one of cash/upi must be > 0 (a "100% discount"
// is technically valid only at booking creation, not at collection).
//
// `discountAmount` is OPTIONAL on the input for backwards compat with
// older call sites; defaulted to 0 internally.
export type RemainderSplit = {
  cashAmount: number;
  upiAmount: number;
  discountAmount?: number;
};

function describeSplit(cash: number, upi: number, discount: number = 0): string {
  const parts: string[] = [];
  if (cash > 0) parts.push(`Rs.${cash} Cash`);
  if (upi > 0) parts.push(`Rs.${upi} UPI QR`);
  if (discount > 0) parts.push(`Rs.${discount} Discount`);
  return parts.length > 0 ? parts.join(" + ") : "no collection";
}

// Mark the venue-side remainder of a partial-payment booking as collected.
// Accepts a split between cash and UPI QR (either can be 0 but the sum
// must equal the remainder owed). Adds the full remainder to
// Payment.amount, zeroes remainingAmount so the "Cash Due at Venue" KPI
// and per-row chips drop off, flips status to COMPLETED, and writes an
// audit row in BookingEditHistory. `remainderMethod` is set to CASH or
// UPI_QR when the collection was single-method (for back-compat with
// display code) and left null when the collection was split.
export async function markRemainderCollected(
  bookingId: string,
  split: RemainderSplit,
) {
  const adminId = await requireAdmin();

  const cashAmount = Math.trunc(split.cashAmount ?? 0);
  const upiAmount = Math.trunc(split.upiAmount ?? 0);
  const discountAmount = Math.trunc(split.discountAmount ?? 0);
  if (cashAmount < 0 || upiAmount < 0 || discountAmount < 0) {
    return { success: false, error: "Amounts cannot be negative" };
  }
  // At least one of cash/UPI must be > 0 — a 100%-discount collection
  // would zero out Payment.amount, which is a refund-shaped operation,
  // not a "remainder collected" one.
  if (cashAmount === 0 && upiAmount === 0) {
    return { success: false, error: "Enter at least one collected amount" };
  }

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { payment: true },
  });
  if (!booking) return { success: false, error: "Booking not found" };
  if (!booking.payment) return { success: false, error: "No payment on this booking" };
  if (!booking.payment.isPartialPayment) {
    return { success: false, error: "Booking is not a partial payment" };
  }
  // Defense in depth: a pass-covered booking must never take remainder
  // money on top of coveredAmount (double-charging the covered hours).
  {
    const red = await db.passRedemption.findFirst({
      where: { bookingId, restoredAt: null },
      select: { id: true },
    });
    if (red || booking.payment.method === "PASS") {
      return {
        success: false,
        error:
          "This booking is (partly) paid with a pass — collect only what the booking detail's pass section shows as owed.",
      };
    }
  }
  // Use Payment.remainingAmount only as the "still owed?" gate — the
  // amount to charge at the venue is derived from totalAmount - advance
  // so historical rows where remainingAmount was stored pre-discount
  // (coupon bug) still validate against the correct post-discount figure.
  const storedRemaining = booking.payment.remainingAmount ?? 0;
  if (storedRemaining <= 0) {
    return { success: false, error: "Remainder already collected" };
  }
  const advance = booking.payment.advanceAmount ?? 0;
  // Legs already taken at the venue on earlier instalments. A discount
  // leg is NOT subtracted here because it was already mirrored onto
  // Booking.totalAmount when it was applied — counting it twice would
  // shrink the balance below what is actually owed.
  const priorCash = booking.payment.remainderCashAmount ?? 0;
  const priorUpi = booking.payment.remainderUpiAmount ?? 0;
  const priorDiscount = booking.payment.remainderDiscountAmount ?? 0;
  const collectedSoFar = priorCash + priorUpi;
  const remaining = Math.max(booking.totalAmount - advance - collectedSoFar, 0);
  if (remaining <= 0) {
    return { success: false, error: "Remainder already collected" };
  }
  // Cash + UPI + Discount may be LESS than the remainder — a customer
  // who pays part now and promises the rest in a few days leaves a
  // smaller balance still due at the venue. It must never EXCEED the
  // remainder, which would be an overpayment, not a collection.
  const applied = cashAmount + upiAmount + discountAmount;
  if (applied > remaining) {
    return {
      success: false,
      error: `Cash + UPI + Discount can't exceed the Rs.${remaining} still owed (got Rs.${applied})`,
    };
  }
  const stillOwed = remaining - applied;

  const admin = await db.adminUser.findUnique({ where: { id: adminId } });
  const adminUsername = admin?.username ?? "unknown";

  // `remainderMethod` keeps the legacy single-method label only when the
  // collection was a single non-discount method. Anything mixed (or any
  // discount applied) leaves it null and lets the display layer fall
  // back to the per-leg amounts.
  // Legs accumulate across repeat collections — collecting Rs.500 today
  // and Rs.500 next week must end up reading Rs.1000 cash, not Rs.500.
  const totalCash = priorCash + cashAmount;
  const totalUpi = priorUpi + upiAmount;
  const totalDiscount = priorDiscount + discountAmount;

  // Derived from the ACCUMULATED legs, so a booking settled in two cash
  // instalments still reads as a plain cash collection.
  const singleMethod =
    totalDiscount === 0 && totalCash > 0 && totalUpi === 0
      ? "CASH"
      : totalDiscount === 0 && totalUpi > 0 && totalCash === 0
      ? "UPI_QR"
      : null;

  // Only cash + UPI count as "actually collected" — the discount slice
  // is not added to Payment.amount. remainingAmount drops to 0 because
  // nothing more is owed (the venue absorbed the discount portion).
  const collectedAtVenue = cashAmount + upiAmount;

  // The at-collection discount also lowers the booking's effective
  // total cost: a customer charged ₹2000 but given an ₹800 goodwill
  // cut paid ₹1200 — so the "Amount" field on the detail page should
  // read ₹1200, not ₹2000. We mirror the discount onto Booking.
  // discountAmount (alongside any pre-existing coupon discount) and
  // re-derive originalAmount so the strike-through "₹X" pill stays
  // accurate. Skip the booking write when discountAmount is 0 to
  // avoid touching the row unnecessarily.
  const newBookingTotal = booking.totalAmount - discountAmount;
  const newBookingDiscount = booking.discountAmount + discountAmount;
  const newBookingOriginal =
    newBookingDiscount > 0 ? newBookingTotal + newBookingDiscount : null;

  await db.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: booking.payment!.id },
      data: {
        amount: booking.payment!.amount + collectedAtVenue,
        remainingAmount: stillOwed,
        remainderMethod: singleMethod,
        remainderCashAmount: totalCash,
        remainderUpiAmount: totalUpi,
        remainderDiscountAmount: totalDiscount > 0 ? totalDiscount : null,
        // Only COMPLETED once nothing is left owed — a part-collection
        // stays PARTIAL so the booking keeps showing up under "Cash Due
        // at Venue" for the balance.
        status: stillOwed > 0 ? "PARTIAL" : "COMPLETED",
        // Every cash-basis figure — the Sports Earnings KPI, "Today's
        // Earning", the CA report — filters on confirmedAt. A payment
        // that reaches COMPLETED without one is money in the till that
        // none of them can see; six such rows had to be backfilled on
        // production. Stamp it the moment the money lands.
        //
        // Only when it isn't already set. A partial carries the ADVANCE's
        // timestamp, and overwriting that with today would move the
        // advance into a later accounting month.
        ...(stillOwed <= 0 && !booking.payment!.confirmedAt
          ? { confirmedAt: new Date(), confirmedBy: adminId }
          : {}),
      },
    });
    await tx.bookingEditHistory.create({
      data: {
        bookingId,
        adminId,
        adminUsername,
        editType: "REMAINDER_COLLECTED",
        // Record what was actually taken THIS time plus what is still
        // owed — "collected Rs.2000" on a part payment would misread the
        // ledger later.
        note: `Collected Rs.${applied} of Rs.${remaining} at venue: ${describeSplit(
          cashAmount,
          upiAmount,
          discountAmount,
        )}${stillOwed > 0 ? ` — Rs.${stillOwed} still due` : ""}`,
      },
    });
    if (discountAmount > 0) {
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          totalAmount: newBookingTotal,
          discountAmount: newBookingDiscount,
          originalAmount: newBookingOriginal,
        },
      });
    }
  });

  // Top up the customer's rewards for the remainder they just paid
  // at the venue. The initial EARNED_BOOKING was credited on the
  // advance at booking-confirm time; this delta brings the total
  // earn up to what the full bill would have earned. Helper is
  // idempotent (@@unique([type=EARNED_BOOKING_REMAINDER, bookingId]))
  // + self-gates on Payment.status === "COMPLETED" and the
  // admin-created flag, so calling unconditionally is safe.
  after(async () => {
    await awardBookingRemainderPoints(bookingId).catch((err) =>
      console.error("[rewards] remainder award failed for", bookingId, err),
    );
  });

  await revalidateBookingPaths(bookingId);

  return { success: true };
}

// Edit the cash/UPI/discount split on a partial-payment booking whose
// remainder has already been collected. Re-attributes the same
// venue-side total across the three legs to fix entry mistakes after
// the fact. Updates Payment.amount when the discount portion changes
// (since cash + UPI is what counts as "actually collected"), keeps
// remainingAmount / status at COMPLETED, and writes an audit row with
// the before/after values.
export async function updateRemainderSplit(
  bookingId: string,
  split: RemainderSplit,
) {
  const adminId = await requireAdmin();

  const cashAmount = Math.trunc(split.cashAmount ?? 0);
  const upiAmount = Math.trunc(split.upiAmount ?? 0);
  const discountAmount = Math.trunc(split.discountAmount ?? 0);
  if (cashAmount < 0 || upiAmount < 0 || discountAmount < 0) {
    return { success: false, error: "Amounts cannot be negative" };
  }

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { payment: true },
  });
  if (!booking) return { success: false, error: "Booking not found" };
  if (!booking.payment) return { success: false, error: "No payment on this booking" };
  if (!booking.payment.isPartialPayment) {
    return { success: false, error: "Booking is not a partial payment" };
  }
  {
    const red = await db.passRedemption.findFirst({
      where: { bookingId, restoredAt: null },
      select: { id: true },
    });
    if (red || booking.payment.method === "PASS") {
      return {
        success: false,
        error:
          "This booking is (partly) paid with a pass — its split can't be edited here.",
      };
    }
  }
  if ((booking.payment.remainingAmount ?? 0) > 0) {
    return { success: false, error: "Remainder not yet collected" };
  }

  // The total collected at the venue is the advance-less portion of the
  // booking total. Reject any split that doesn't sum to that.
  const advance = booking.payment.advanceAmount ?? 0;
  const venueTotal = booking.totalAmount - advance;
  if (cashAmount + upiAmount + discountAmount !== venueTotal) {
    return {
      success: false,
      error: `Cash + UPI + Discount must total Rs.${venueTotal} (got Rs.${
        cashAmount + upiAmount + discountAmount
      })`,
    };
  }
  if (cashAmount === 0 && upiAmount === 0) {
    return { success: false, error: "Enter at least one collected amount" };
  }

  const priorCash =
    booking.payment.remainderCashAmount ??
    (booking.payment.remainderMethod === "CASH" ? venueTotal : 0);
  const priorUpi =
    booking.payment.remainderUpiAmount ??
    (booking.payment.remainderMethod === "UPI_QR" ? venueTotal : 0);
  const priorDiscount = booking.payment.remainderDiscountAmount ?? 0;
  if (
    priorCash === cashAmount &&
    priorUpi === upiAmount &&
    priorDiscount === discountAmount
  ) {
    return { success: false, error: "No changes to save" };
  }

  const admin = await db.adminUser.findUnique({ where: { id: adminId } });
  const adminUsername = admin?.username ?? "unknown";

  // This is a CORRECTION of an existing split, not another instalment —
  // the new figures replace the stored ones, so no accumulation here.
  const singleMethod =
    discountAmount === 0 && cashAmount > 0 && upiAmount === 0
      ? "CASH"
      : discountAmount === 0 && upiAmount > 0 && cashAmount === 0
      ? "UPI_QR"
      : null;

  // The actually-collected total (cash + UPI) drives Payment.amount. We
  // adjust by the delta vs the prior cash+UPI so this stays correct
  // when the discount slice grows or shrinks.
  const newCollected = cashAmount + upiAmount;
  const priorCollected = priorCash + priorUpi;
  const delta = newCollected - priorCollected;

  // The booking-level total/discount also need to slide by the inverse
  // of the at-collection discount delta. Growing the discount portion
  // lowers Booking.totalAmount (the venue absorbed more); shrinking it
  // raises Booking.totalAmount. Coupon discounts that were already on
  // the booking row stay folded into the running discountAmount.
  const discountDelta = discountAmount - priorDiscount;
  const newBookingTotal = booking.totalAmount - discountDelta;
  const newBookingDiscount = booking.discountAmount + discountDelta;
  // Invariant: originalAmount = totalAmount + discountAmount when a
  // discount applies; null when no discount. Re-derive from the new
  // figures rather than preserving the old originalAmount, so dropping
  // the discount to zero clears the strike-through pill correctly.
  const newBookingOriginal =
    newBookingDiscount > 0 ? newBookingTotal + newBookingDiscount : null;

  await db.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: booking.payment!.id },
      data: {
        ...(delta !== 0
          ? { amount: booking.payment!.amount + delta }
          : {}),
        remainderMethod: singleMethod,
        remainderCashAmount: cashAmount,
        remainderUpiAmount: upiAmount,
        remainderDiscountAmount: discountAmount > 0 ? discountAmount : null,
      },
    });
    await tx.bookingEditHistory.create({
      data: {
        bookingId,
        adminId,
        adminUsername,
        editType: "REMAINDER_SPLIT_EDITED",
        note: `Updated venue collection split from ${describeSplit(
          priorCash,
          priorUpi,
          priorDiscount,
        )} to ${describeSplit(cashAmount, upiAmount, discountAmount)}`,
      },
    });
    if (discountDelta !== 0) {
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          totalAmount: newBookingTotal,
          discountAmount: newBookingDiscount,
          originalAmount: newBookingOriginal,
        },
      });
    }
  });

  await revalidateBookingPaths(bookingId);

  // The venue-collected total (cash + UPI) that backs Payment.amount just
  // changed, so the earn credited on it is now stale. Re-sync it to the
  // new amount the way markRemainderCollected does — top up or adjust
  // down. Deferred via after() (a bare fire-and-forget dies on freeze);
  // self-gates to a no-op when the collected total didn't move.
  after(async () => {
    await reconcileBookingEarn(bookingId).catch((err) =>
      console.error("[rewards] reconcile failed for", bookingId, err),
    );
  });

  return { success: true };
}

export async function cancelBooking(bookingId: string, reason: string) {
  await requireAdmin();

  if (!reason.trim()) {
    return { success: false, error: "Cancellation reason is required" };
  }

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { payment: true, slots: true },
  });

  if (!booking) {
    return { success: false, error: "Booking not found" };
  }

  if (booking.status === "CANCELLED") {
    return { success: false, error: "Booking is already cancelled" };
  }

  // Cancel booking — frees the slot, no refund
  await db.$transaction([
    db.booking.update({
      where: { id: bookingId },
      data: { status: "CANCELLED" },
    }),
  ]);

  // Pass-paid booking → hours go back on the pass (no-op otherwise).
  await restorePassForBooking(bookingId).catch(() => {});

  await revalidateBookingPaths(bookingId);

  // Deferred so the admin's roundtrip stays fast and a flaky FCM call
  // doesn't surface as a UI error on a successful cancellation — but via
  // after(), because a bare fire-and-forget is killed when the serverless
  // instance freezes on the response, before any of these even reach
  // their first query.
  after(async () => {
    await Promise.allSettled([
      // Push notification to the customer.
      notifyBookingCancelled(bookingId, reason),
      // Floor-staff fan-out: the OTHER admins on the team learn about
      // the cancel without paging them via SMS.
      notifyAdminBookingCancelled(bookingId, reason, false),
      // Fan out to anyone waitlisted for the now-freed slots. Race is
      // resolved by the existing 10-min slot lock, so we deliberately
      // notify EVERY matching waitlister at once.
      notifyWaitlistersForFreedSlots({
        courtConfigId: booking.courtConfigId,
        date: booking.date,
        hours: booking.slots.map((s) => s.startHour),
      }),
      // Unwind reward points — revoke any earn + refund any redemption.
      // Idempotent so safe to run from both cancel + refund paths.
      revokeBookingRewards(bookingId).catch((err) =>
        console.error("[rewards] revoke failed for", bookingId, err),
      ),
    ]);
  });

  // Tell the customer — fire-and-forget, never blocks the operation.
  void notifyBookingActivity(bookingId, "CANCELLED", { reason });

  return { success: true };
}

// Helper used by both cancelBooking and refundBooking. Only the title
// differs ("cancelled" vs "refunded") — everything else is identical so
// the customer sees a consistent notification.
async function notifyBookingCancelled(
  bookingId: string,
  reason: string,
  refunded: boolean = false,
): Promise<void> {
  try {
    const b = await db.booking.findUnique({
      where: { id: bookingId },
      select: {
        userId: true,
        date: true,
        slots: { orderBy: { startHour: "asc" }, select: { startHour: true } },
      },
    });
    if (!b) return;
    const dateLabel = b.date.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      timeZone: "Asia/Kolkata",
    });
    const timeLabel =
      b.slots.length > 0
        ? formatHoursAsRanges(b.slots.map((s) => s.startHour))
        : "";
    const when = [dateLabel, timeLabel].filter(Boolean).join(" ");
    await sendTemplatedToUser(
      b.userId,
      refunded ? "booking_refunded" : "booking_cancelled",
      {
        when,
        reason: reason ? `Reason: ${reason.slice(0, 120)}` : "",
      },
      {
        kind: refunded ? "refund_processed" : "booking_cancelled",
        bookingId,
      },
    );
  } catch (err) {
    console.error("Cancellation push failed for", bookingId, err);
  }
}

export async function refundBooking(
  bookingId: string,
  reason: string,
  refundMethod?: "ORIGINAL" | "CASH" | "UPI" | "BANK_TRANSFER",
  refundAmount?: number,
) {
  const adminId = await requireAdmin();

  if (!reason.trim()) {
    return { success: false, error: "Refund reason is required" };
  }

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { payment: true, slots: { orderBy: { startHour: "asc" } } },
  });

  if (!booking) {
    return { success: false, error: "Booking not found" };
  }

  if (!booking.payment) {
    return { success: false, error: "No payment found for this booking" };
  }

  if (booking.payment.status === "REFUNDED") {
    return { success: false, error: "Payment is already refunded" };
  }

  const actualRefundAmount = refundAmount ?? booking.payment.amount;
  const isPartialRefund = actualRefundAmount < booking.payment.amount;
  const refundMethodStr = refundMethod || "ORIGINAL";

  // Pass-paid booking → hours go back on the pass (no-op otherwise).
  await restorePassForBooking(bookingId).catch(() => {});

  await db.$transaction([
    db.booking.update({
      where: { id: bookingId },
      data: { status: "CANCELLED" },
    }),
    db.payment.update({
      where: { id: booking.payment.id },
      data: {
        status: "REFUNDED",
        refundedBy: adminId,
        refundedAt: new Date(),
        // No /100 here — Payment.amount and refundAmount are already in
        // rupees, and this string is rendered verbatim to the customer.
        refundReason: `[${refundMethodStr}]${isPartialRefund ? ` [Partial: ₹${actualRefundAmount}]` : ""} ${reason}`,
      },
    }),
  ]);

  await revalidateBookingPaths(bookingId);

  // after() for the same reason as cancelBooking — a bare fire-and-forget
  // dies with the frozen instance.
  after(async () => {
    await Promise.allSettled([
      // Same lock-screen notification as plain cancellation, but with the
      // refunded copy + the refund_processed kind so analytics can split
      // the two outcomes downstream.
      notifyBookingCancelled(bookingId, reason, true),
      // Mirror to the admin team — the `refunded=true` flag flips the
      // admin push body to mention the refund instead of cancellation.
      notifyAdminBookingCancelled(bookingId, reason, true),
      // Refund frees the slot just like a cancel — notify waitlisters.
      notifyWaitlistersForFreedSlots({
        courtConfigId: booking.courtConfigId,
        date: booking.date,
        hours: booking.slots.map((s) => s.startHour),
      }),
      // Same rewards unwind as cancelBooking.
      revokeBookingRewards(bookingId).catch((err) =>
        console.error("[rewards] revoke failed for", bookingId, err),
      ),
    ]);
  });

  // Tell the customer — fire-and-forget, never blocks the operation.
  void notifyBookingActivity(bookingId, "REFUNDED");

  return { success: true };
}

// ---------------------------------------------------------------------------
// reconcileBookingEarn
// ---------------------------------------------------------------------------
// Bring a booking's EARNED points back in line with the amount the
// customer ACTUALLY paid, after an admin rewrites Payment.amount out
// from under an already-credited earn (adminEditPayment total edits,
// updateRemainderSplit re-attribution). Without this, lowering a bill
// leaves points over-credited (an indirect-currency money leak) and
// raising it leaves the customer short-changed.
//
// Posts a SINGLE balancing adjustment for the delta between what the
// new paid amount OUGHT to earn and the net earn already on the ledger
// for this booking:
//   - under-credited → EARNED_ADJUSTMENT (credit the shortfall)
//   - over-credited  → ADJUSTMENT_DEBIT  (claw the excess back)
//
// Invariant-safe by construction: every write goes through
// applyBalanceDelta in the SAME $transaction as its ledger row (balance
// and ledger can't diverge), and a downward adjustment is capped at the
// customer's available balance so pointsAvailable never goes negative
// (mirrors revoke.ts). Any capped shortfall raises the same
// PARTIAL_REVOKE_SHORTFALL alert — once per booking — for admin follow-up.
//
// Only touches bookings that were ALREADY credited an earn: if no
// EARNED_BOOKING row exists (admin-created, still PENDING, rewards off
// at confirm time) there is nothing to reconcile and the normal
// confirm/remainder paths award on the new amount later. A booking whose
// earn was already revoked (cancel/refund) is terminal and left alone.
// Idempotent: the @@unique([type, bookingId]) index makes each
// adjustment single-shot (a retry lands on P2002 and no-ops), and a
// re-run after convergence computes a zero delta.
async function reconcileBookingEarn(bookingId: string): Promise<void> {
  const cfg = await getRewardConfig();
  // Rewards globally off / zero rate → leave the ledger untouched. Never
  // claw back historical earn just because the programme was paused.
  if (!cfg.enabled || cfg.earnRateBookingBps <= 0) return;

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { payment: true, courtConfig: { select: { sport: true } } },
  });
  if (!booking || !booking.payment) return;
  const payment = booking.payment;

  // A booking whose remainder is still owed gets its TOTAL earn
  // reconciled against EARNED_BOOKING by awardBookingRemainderPoints when
  // the venue collection is recorded (markRemainderCollected). That
  // top-up keys off the EARNED_BOOKING row alone, so an adjustment posted
  // here would be invisible to its math and end up double-counted — leave
  // pending-remainder bookings to that path.
  if (payment.isPartialPayment && (payment.remainingAmount ?? 0) > 0) return;

  // The booking's own earn credits, keyed by bookingId (one EARNED_BOOKING
  // and at most one EARNED_BOOKING_REMAINDER, guaranteed by
  // @@unique([type, bookingId])). Redemptions are a separate lifecycle and
  // are deliberately excluded.
  const bookingRows = await db.rewardTransaction.findMany({
    where: {
      bookingId,
      type: {
        in: ["EARNED_BOOKING", "EARNED_BOOKING_REMAINDER", "REVOKED"],
      },
    },
  });
  const initialEarn = bookingRows.find((r) => r.type === "EARNED_BOOKING");
  if (!initialEarn) return; // never earned → nothing to reconcile
  // Already revoked (cancel/refund) → terminal, don't resurrect the earn.
  if (bookingRows.some((r) => r.type === "REVOKED")) return;

  // Prior reconcile adjustments are linked to the initial earn by
  // sourceTxnId, NOT by bookingId. @@unique([type, bookingId]) caps a
  // booking at one EARNED_ADJUSTMENT and one ADJUSTMENT_DEBIT for life, so
  // keying them on bookingId made every payment edit after the first hit a
  // unique violation that got swallowed — leaving the customer over- or
  // under-credited. sourceTxnId has no such constraint, so each edit posts
  // a fresh adjustment and the running total below stays exact.
  const adjRows = await db.rewardTransaction.findMany({
    where: {
      sourceTxnId: initialEarn.id,
      type: { in: ["EARNED_ADJUSTMENT", "ADJUSTMENT_DEBIT"] },
    },
  });
  const earnRows = [...bookingRows, ...adjRows];

  // What the new paid amount OUGHT to earn. previewBookingEarn is the
  // canonical mirror of awardBookingPoints' formula; enabledSports:[]
  // skips the sport-policy gate on purpose — this booking already proved
  // eligible when it earned, so a payment edit must not hinge on whether
  // the sport is still enabled today.
  const target = previewBookingEarn({
    billPaise: payment.amount * 100,
    sport: booking.courtConfig.sport,
    createdByAdmin: false,
    config: {
      enabled: cfg.enabled,
      earnRateBookingBps: cfg.earnRateBookingBps,
      enabledSports: [],
    },
  });

  const current = earnRows.reduce((sum, r) => sum + r.points, 0);
  const delta = target - current;
  if (delta === 0) return;

  const userId = initialEarn.userId;
  const now = new Date();

  if (delta > 0) {
    // Under-credited — top the customer up. bookingId is null on purpose:
    // attribution flows through sourceTxnId → the EARNED_BOOKING row (which
    // carries the bookingId), and a null bookingId sidesteps the
    // @@unique([type, bookingId]) cap so repeated edits each post cleanly.
    await db.$transaction(async (tx) => {
      await ensureBalance(tx, userId);
      await tx.rewardTransaction.create({
        data: {
          type: "EARNED_ADJUSTMENT",
          points: delta,
          pointsValuePaise: pointsToPaise(delta, cfg),
          userId,
          bookingId: null,
          sourceTxnId: initialEarn.id,
          reason: `Payment edited (booking ${bookingId}) — earn topped up to match Rs.${payment.amount} paid`,
        },
      });
      await applyBalanceDelta(tx, { userId, points: delta, type: "EARNED", now });
    });
    return;
  }

  // Over-credited — claw the excess back, capped at what the customer
  // still has so pointsAvailable never goes negative (mirrors revoke.ts).
  const wanted = -delta;
  const balance = await db.rewardBalance.findUnique({ where: { userId } });
  const available = balance?.pointsAvailable ?? 0;
  const actual = Math.min(available, wanted);
  if (actual > 0) {
    // bookingId null / sourceTxnId link — same reasoning as the top-up
    // branch above: dodges the one-adjustment-per-booking unique cap.
    await db.$transaction(async (tx) => {
      await ensureBalance(tx, userId);
      await tx.rewardTransaction.create({
        data: {
          type: "ADJUSTMENT_DEBIT",
          points: -actual,
          pointsValuePaise: -pointsToPaise(actual, cfg),
          userId,
          bookingId: null,
          sourceTxnId: initialEarn.id,
          reason: `Payment edited (booking ${bookingId}) — earn reduced to match Rs.${payment.amount} paid`,
        },
      });
      await applyBalanceDelta(tx, {
        userId,
        points: -actual,
        type: "ADJUSTMENT_DEBIT",
        now,
      });
    });
  }

  // Couldn't fully claw back (customer already spent the excess) — flag
  // it, once per booking, the same way revoke.ts does.
  const shortfall = wanted - actual;
  if (shortfall > 0) {
    const openAlerts = await db.rewardAlert.findMany({
      where: { userId, kind: "PARTIAL_REVOKE_SHORTFALL", status: "OPEN" },
      select: { details: true },
    });
    const alreadyFlagged = openAlerts.some(
      (a) =>
        a.details !== null &&
        typeof a.details === "object" &&
        !Array.isArray(a.details) &&
        (a.details as Record<string, unknown>).bookingId === bookingId,
    );
    if (!alreadyFlagged) {
      await db.rewardAlert.create({
        data: {
          userId,
          kind: "PARTIAL_REVOKE_SHORTFALL",
          severity: "MEDIUM",
          status: "OPEN",
          details: {
            bookingId,
            wantedClawback: wanted,
            actualClawback: actual,
            shortfall,
            earnTxnId: initialEarn.id,
            source: "adminEditPayment",
          },
        },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// adminEditPayment
// ---------------------------------------------------------------------------
// Edit an existing booking's payment record after the fact. Covers
// cases the create form can't catch:
//
//   - Customer paid via Razorpay but the gateway callback failed,
//     admin had to re-create the booking manually as Cash/UPI_QR;
//     now wants to fix the method + record the Razorpay reference.
//   - Wrong payment method recorded (e.g. UPI_QR logged as Cash).
//   - Total amount needs adjustment without going through the
//     slot-edit / refund paths.
//   - Admin needs to retroactively log a UTR or Razorpay transaction
//     id on a partial-payment booking.
//
// Every field is optional; pass only what changed. The action
// rewrites Booking.totalAmount alongside the payment so the two stay
// in lockstep, recomputes the partial-payment derived fields
// (advance/remaining/status), and writes a BookingEditHistory row.
//
// Status transitions are NOT auto-derived — admin can override
// status independently. Combined with the new "Confirm Booking"
// button this is the full escape hatch toolbox for stuck states.
type EditablePaymentMethod = "CASH" | "UPI_QR" | "RAZORPAY" | "PHONEPE" | "FREE";
type EditablePaymentStatus =
  | "PENDING"
  | "PARTIAL"
  | "COMPLETED"
  | "REFUNDED"
  | "FAILED";

export async function adminEditPayment(
  bookingId: string,
  patch: {
    method?: EditablePaymentMethod;
    status?: EditablePaymentStatus;
    totalAmount?: number;
    advanceAmount?: number | null;
    isPartialPayment?: boolean;
    razorpayPaymentId?: string | null;
    utrNumber?: string | null;
    note?: string;
  },
) {
  const admin = await requireAdminWithDetails();

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { payment: true },
  });
  if (!booking) {
    return { success: false as const, error: "Booking not found" };
  }
  if (!booking.payment) {
    return { success: false as const, error: "No payment row to edit" };
  }
  // Pass-covered bookings manage their money through the pass ledger
  // (Payment.amount + PassRedemption.coveredAmount). Manual payment
  // surgery here would desync coveredAmount and double-charge or hide
  // the covered hours — route admins to edit-slots (with the pass
  // option), cancel, or refund instead.
  {
    const red = await db.passRedemption.findFirst({
      where: { bookingId, restoredAt: null },
      select: { id: true },
    });
    if (red || booking.payment.method === "PASS") {
      return {
        success: false as const,
        error:
          "This booking is (partly) paid with a pass — its payment figures are managed automatically. Edit slots (with the pass option), cancel, or refund instead.",
      };
    }
  }
  const prior = booking.payment;

  // Resolve final field values: take the explicit patch when given,
  // else keep the existing value. Cast through the enums so the Prisma
  // update accepts them.
  const newMethod = (patch.method ?? prior.method) as EditablePaymentMethod;
  const newStatus = (patch.status ?? prior.status) as EditablePaymentStatus;
  const newTotal =
    typeof patch.totalAmount === "number"
      ? Math.max(0, Math.trunc(patch.totalAmount))
      : booking.totalAmount;
  const newIsPartial =
    typeof patch.isPartialPayment === "boolean"
      ? patch.isPartialPayment
      : prior.isPartialPayment;

  // Advance handling. When isPartial is false we zero out the advance
  // fields so the row state stays internally consistent; when true,
  // the advance must be ≥0 and < total.
  let newAdvance: number | null;
  if (!newIsPartial) {
    newAdvance = null;
  } else {
    const candidate =
      patch.advanceAmount === undefined
        ? (prior.advanceAmount ?? 0)
        : patch.advanceAmount;
    if (candidate === null || !Number.isFinite(candidate) || candidate < 0) {
      return {
        success: false as const,
        error: "Advance must be ≥ 0 for a partial payment",
      };
    }
    if (candidate >= newTotal) {
      return {
        success: false as const,
        error: "Advance must be less than the total",
      };
    }
    newAdvance = Math.trunc(candidate);
  }
  // Payment.amount semantics:
  //   - Non-partial: equals total (the full charge captured).
  //   - Partial PARTIAL: advance + whatever the venue has already taken.
  //   - Partial COMPLETED: equals total (advance + remainder both in).
  //
  // Both figures come from the shared helper, which nets off the venue
  // legs. Deriving them from (total, advance, status) alone — as this
  // did — asserts that the advance is the only money in, and that stops
  // being true the moment the counter collects a remainder: a status
  // correction then wiped the collected cash out of Payment.amount and
  // re-opened a balance that was already settled.
  const { amount: newAmount, remainingAmount: newRemaining } =
    recomputePartialPaymentAmounts({
      total: newTotal,
      advance: newAdvance,
      status: newStatus,
      isPartial: newIsPartial,
      alreadyCollected: venueCollected(prior),
    });

  // Gateway-id fields — only meaningful for the matching method.
  // Setting an explicit empty string clears the field; null clears;
  // undefined leaves the existing value alone.
  function resolveOptionalString(
    incoming: string | null | undefined,
    existing: string | null,
  ): string | null {
    if (incoming === undefined) return existing;
    if (incoming === null) return null;
    const trimmed = incoming.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  const newRazorpayId = resolveOptionalString(
    patch.razorpayPaymentId,
    prior.razorpayPaymentId,
  );
  const newUtr = resolveOptionalString(patch.utrNumber, prior.utrNumber);

  await db.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: prior.id },
      data: {
        method: newMethod,
        status: newStatus,
        amount: newAmount,
        isPartialPayment: newIsPartial,
        advanceAmount: newAdvance,
        remainingAmount: newRemaining,
        razorpayPaymentId: newRazorpayId,
        utrNumber: newUtr,
        // Correcting a payment INTO completed is a collection like any
        // other, and cash reporting keys on confirmedAt. Without this a
        // status correction produced money no cash-basis figure counted.
        // Never overwrite an existing stamp: that would silently move the
        // money into a different accounting month.
        ...(newStatus === "COMPLETED" && !prior.confirmedAt
          ? { confirmedAt: new Date() }
          : {}),
      },
    });

    if (newTotal !== booking.totalAmount) {
      // Re-derive originalAmount alongside total — same invariant the
      // edit-slots / mark-collected paths use: originalAmount =
      // totalAmount + discountAmount when there's a discount, else
      // null. discountAmount is preserved as-is here because the
      // admin is editing payment, not the booking-level discount.
      const newOriginal =
        booking.discountAmount > 0 ? newTotal + booking.discountAmount : null;
      await tx.booking.update({
        where: { id: bookingId },
        data: { totalAmount: newTotal, originalAmount: newOriginal },
      });
    }

    const summaryParts: string[] = [];
    if (patch.method && patch.method !== prior.method) {
      summaryParts.push(`method ${prior.method} → ${newMethod}`);
    }
    if (patch.status && patch.status !== prior.status) {
      summaryParts.push(`status ${prior.status} → ${newStatus}`);
    }
    if (
      typeof patch.totalAmount === "number" &&
      patch.totalAmount !== booking.totalAmount
    ) {
      summaryParts.push(`total ${booking.totalAmount} → ${newTotal}`);
    }
    if (
      patch.advanceAmount !== undefined &&
      patch.advanceAmount !== prior.advanceAmount
    ) {
      summaryParts.push(`advance ${prior.advanceAmount ?? "—"} → ${newAdvance ?? "—"}`);
    }
    if (
      patch.isPartialPayment !== undefined &&
      patch.isPartialPayment !== prior.isPartialPayment
    ) {
      summaryParts.push(`isPartial ${prior.isPartialPayment} → ${newIsPartial}`);
    }
    if (
      patch.razorpayPaymentId !== undefined &&
      newRazorpayId !== prior.razorpayPaymentId
    ) {
      summaryParts.push(
        `razorpayId ${prior.razorpayPaymentId ?? "—"} → ${newRazorpayId ?? "—"}`,
      );
    }
    if (patch.utrNumber !== undefined && newUtr !== prior.utrNumber) {
      summaryParts.push(`utr ${prior.utrNumber ?? "—"} → ${newUtr ?? "—"}`);
    }

    if (summaryParts.length > 0 || patch.note?.trim()) {
      await tx.bookingEditHistory.create({
        data: {
          bookingId,
          adminId: admin.id,
          adminUsername: admin.username,
          editType: "PAYMENT_EDITED",
          previousAmount: booking.totalAmount,
          newAmount: newTotal,
          note: [summaryParts.join(", "), patch.note?.trim()]
            .filter(Boolean)
            .join(" — "),
        },
      });
    }
  });

  await revalidateBookingPaths(bookingId);

  // Reconcile rewards to the money that actually changed. Deferred via
  // after() because a bare fire-and-forget dies when the serverless
  // instance freezes on the response.
  after(async () => {
    if (newStatus === "REFUNDED") {
      // Money's been refunded — claw the earn back like the cancel/refund
      // paths (revoke is idempotent + also returns any redeemed points).
      // adminEditPayment leaves Booking.status alone, so the alerts.ts
      // REFUND_THEN_RETAIN backstop (which keys off status=CANCELLED)
      // never fires here — this direct revoke is the clawback.
      await revokeBookingRewards(bookingId).catch((err) =>
        console.error("[rewards] revoke failed for", bookingId, err),
      );
    } else {
      // Payment.amount / total was rewritten — re-sync the earn to the
      // new paid amount so we neither over- nor under-credit.
      await reconcileBookingEarn(bookingId).catch((err) =>
        console.error("[rewards] reconcile failed for", bookingId, err),
      );
    }
  });

  // Tell the customer — fire-and-forget, never blocks the operation.
  void notifyBookingActivity(bookingId, "PAYMENT_UPDATED");

  return { success: true as const };
}

export async function getAdminBookings(filters?: {
  date?: string;
  // Multi-select filters — string[] or a single string ("ALL"
  // disables, "" disables). The web layer parses URL CSV; the
  // mobile client passes string[] directly. Server normalises both
  // shapes via toFilterList() below.
  sport?: string | string[];
  status?: string | string[];
  paymentMethod?: string;
  platform?: string | string[];
  // Payment-completion filter on top of the payment.status enum.
  // Two values are surfaced to admin staff:
  //   - "completed"  payment.status === COMPLETED (everything settled)
  //   - "pending"    booking.status === CONFIRMED AND
  //                  (payment.status != COMPLETED OR payment is null)
  //                  i.e. confirmed-but-money-still-owed: PARTIAL
  //                  remainders, UPI awaiting cash collection, etc.
  payment?: string | string[];
  /** Free-text user search — matches against name, phone, OR email.
   *  Useful when a customer rings up and the front desk needs to
   *  pull their booking by phone number / name without scrolling. */
  q?: string;
  page?: number;
  limit?: number;
  /**
   * Result ordering. Defaults to "createdAt" — the front desk sees
   * the most recently booked rows first, which matches the
   * order-of-receipt-printed mental model. "date" sorts by the
   * actual session date instead so the upcoming/recent SLOTS line
   * up regardless of when the booking was placed (e.g. recurring
   * series created weeks ago).
   */
  sort?: "createdAt" | "date";
}) {
  await requireAdmin();

  const page = filters?.page ?? 1;
  const limit = filters?.limit ?? 20;
  const skip = (page - 1) * limit;

  // Normalise a multi-select filter param to a clean string[]. Accepts
  // either an array (mobile JSON body) or a CSV string (web URL).
  // Empty / "ALL" / "" values disable the filter (returns []).
  const toFilterList = (raw: string | string[] | undefined): string[] => {
    if (!raw) return [];
    const list = Array.isArray(raw)
      ? raw
      : raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
    return list.filter((v) => v !== "ALL");
  };

  const where: Record<string, unknown> = {};

  if (filters?.date) {
    where.date = new Date(filters.date);
  }

  const statusList = toFilterList(filters?.status);
  if (statusList.length > 0) {
    where.status =
      statusList.length === 1 ? statusList[0] : { in: statusList };
  }

  const sportList = toFilterList(filters?.sport);
  if (sportList.length > 0) {
    where.courtConfig =
      sportList.length === 1
        ? { sport: sportList[0] }
        : { sport: { in: sportList } };
  }

  const platformList = toFilterList(filters?.platform);
  if (platformList.length > 0) {
    where.platform =
      platformList.length === 1 ? platformList[0] : { in: platformList };
  }

  // User search — matches the customer's name (case-insensitive
  // substring), phone (substring), or email (case-insensitive). The
  // OR sits under `user` so it composes cleanly with the top-level
  // payment-completion OR clause below.
  const q = filters?.q?.trim();
  if (q) {
    where.user = {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
        { email: { contains: q, mode: "insensitive" } },
      ],
    };
  }

  // Payment-completion filter — semantically single-value (a booking
  // is either fully settled or it owes money). When the URL/array
  // contains BOTH "completed" + "pending" the union covers
  // everything, so we just drop the filter entirely.
  const paymentList = toFilterList(filters?.payment);
  const paymentVal = paymentList.length === 1 ? paymentList[0] : null;
  if (paymentVal === "completed") {
    where.payment = { is: { status: "COMPLETED" } };
  } else if (paymentVal === "pending") {
    // "pending payment" is "CONFIRMED + money still owed." When the
    // user's explicit status filter doesn't include CONFIRMED we
    // short-circuit to no matches instead of silently broadening
    // beyond what they picked.
    if (statusList.length > 0 && !statusList.includes("CONFIRMED")) {
      where.id = "__no_match__";
    } else {
      // Pin to CONFIRMED so cancelled/absent bookings don't show up
      // as "money owed" even if their payment row is PARTIAL.
      where.status = "CONFIRMED";
      where.OR = [
        { payment: { is: { status: { not: "COMPLETED" } } } },
        { payment: { is: null } },
      ];
    }
  }

  const [bookings, total] = await Promise.all([
    db.booking.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, phone: true } },
        courtConfig: true,
        slots: { orderBy: { startHour: "asc" } },
        payment: true,
        recurringBooking: {
          include: {
            bookings: {
              where: { payment: { isNot: null } },
              include: { payment: true },
              take: 1,
              orderBy: { date: "asc" },
            },
          },
        },
      },
      // "createdAt" (default) — most recent receipt first. Mirrors
      // the front-desk order-of-creation mental model.
      // "date" — actual session date first, with createdAt as the
      // tiebreaker so multiple bookings for the same date stay
      // chronological among themselves.
      orderBy:
        filters?.sort === "date"
          ? [{ date: "desc" }, { createdAt: "desc" }]
          : [{ createdAt: "desc" }],
      skip,
      take: limit,
    }),
    db.booking.count({ where }),
  ]);

  // For recurring child bookings without direct payment, inherit from the series' first booking
  const enrichedBookings = bookings.map((booking) => {
    if (!booking.payment && booking.recurringBooking?.bookings?.[0]?.payment) {
      return {
        ...booking,
        payment: booking.recurringBooking.bookings[0].payment,
        _isRecurringChildPayment: true,
      };
    }
    return { ...booking, _isRecurringChildPayment: false };
  });

  return { bookings: enrichedBookings, total, page, totalPages: Math.ceil(total / limit) };
}

export async function getAdminStats() {
  // Stats viewable by any admin (no specific permission required) — but the
  // aggregate business numbers (lifetime bookings, today's earning, total
  // revenue) are owner-only. Gated HERE, not in the page: a hidden tile
  // whose value still rides the payload isn't hidden at all.
  const { requireAdmin: requireAdminNoPermission } = await import("@/lib/admin-auth");
  const adminIdentity = await requireAdminNoPermission();
  const isSuperadmin = adminIdentity.adminRole === "SUPERADMIN";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [
    totalBookings,
    todayBookings,
    totalUsers,
    todayRevenue,
    totalRevenue,
    pendingPayments,
    venueDueAgg,
    lifetimeEarnings,
    firstBooking,
    todayEarningAgg,
  ] = await Promise.all([
    db.booking.count({
      where: { status: { in: [...EARNING_BOOKING_STATUSES] } },
    }),
    db.booking.count({
      where: { date: today, status: { in: [...EARNING_BOOKING_STATUSES] } },
    }),
    db.user.count({ where: { deletedAt: null } }),
    // Revenue is summed from Booking.totalAmount (post-discount) rather
    // than Payment.amount. Payment.amount stores what the gateway charged,
    // which for a handful of discount-applied bookings diverged from the
    // actually-owed total (pre-discount payments where only Booking.total
    // got reduced). Booking.totalAmount is authoritatively the final
    // figure, so it reconciles today's revenue (e.g. ₹6,100 with a ₹100
    // coupon) regardless of how the discount flow wrote the Payment row.
    //
    // Scoped to COMPLETED payments (excludes PARTIAL advances still owed
    // at venue) + CONFIRMED bookings (drops cancellations). Date filter
    // goes on payment.confirmedAt so "today's revenue" means "money
    // recognized today".
    db.booking.aggregate({
      where: {
        status: { in: [...EARNING_BOOKING_STATUSES] },
        payment: {
          status: "COMPLETED",
          confirmedAt: { gte: today, lt: tomorrow },
        },
      },
      _sum: { totalAmount: true },
    }),
    // "Total Sports Earnings" — must match the analytics-page KPI
    // query verbatim. The analytics query has a confirmedAt
    // window; for a windowless lifetime total here we still
    // require confirmedAt to be non-null so historical COMPLETED
    // payments that were never timestamp-stamped don't slip in
    // and create a divergent number vs the analytics dashboard.
    //
    // Without this guard, the all-bookings tile counts every
    // CONFIRMED+COMPLETED booking forever, while the analytics
    // KPI (which uses confirmedAt: { gte: from, lte: to }) drops
    // any payment whose confirmedAt is NULL — surfacing as the
    // ~₹2,000 mystery gap admins kept asking about.
    db.booking.aggregate({
      where: {
        status: { in: [...EARNING_BOOKING_STATUSES] },
        payment: {
          status: "COMPLETED",
          confirmedAt: { not: null },
        },
      },
      _sum: { totalAmount: true },
    }),
    db.payment.count({ where: { status: "PENDING" } }),
    // Cash-due-at-venue from confirmed partial-payment bookings. Only
    // counts advance-paid bookings whose remainder hasn't been collected
    // yet (remainingAmount > 0). Scoped to CONFIRMED bookings so cancelled
    // ones drop out.
    db.payment.aggregate({
      where: {
        isPartialPayment: true,
        remainingAmount: { gt: 0 },
        booking: { status: "CONFIRMED" },
      },
      _sum: { remainingAmount: true },
    }),
    // Lifetime earnings for the "avg per day" tile — pre-discount, so
    // coupon marketing spend doesn't drag the headline number down.
    // Kept separate from totalRevenue above (which is post-discount
    // recognized money) because the tile's intent is "how much did our
    // sports operation gross on a typical day".
    db.booking.aggregate({
      where: { status: { in: [...EARNING_BOOKING_STATUSES] } },
      _sum: { totalAmount: true, originalAmount: true, discountAmount: true },
    }),
    // Earliest Booking.date seeds the denominator for the daily
    // average. Using Booking.date (not createdAt) so a retroactively
    // logged historical booking stretches the denominator correctly.
    db.booking.findFirst({
      where: { status: { in: [...EARNING_BOOKING_STATUSES] } },
      orderBy: { date: "asc" },
      select: { date: true },
    }),
    // ── "Today's Earning" — slot-date sum ─────────────────────────
    // Sum of Booking.totalAmount for every booking that stood whose
    // slot date is today. This is the BOOKED revenue for today's
    // sessions — not the cash flow recognised today. Front desk
    // wants to see "what does today's calendar bring in" at a
    // glance, independent of when the customer's payment was
    // confirmed (an advance paid last week for a slot today still
    // counts in today's earning).
    //
    // Filter on Booking.date (the slot date), non-cancelled statuses
    // so cancellations don't inflate the figure. Deliberately does
    // NOT gate on Payment.status — a partial-payment booking counts
    // its full agreed total because the slot is locked in for today.
    // That is also why closeOutBooking has to write an ABSENT
    // booking's uncollected balance off totalAmount: nothing here
    // would filter it out.
    db.booking.aggregate({
      where: {
        date: today,
        status: { in: [...EARNING_BOOKING_STATUSES] },
      },
      _sum: { totalAmount: true },
    }),
  ]);

  // Pass-settled rupees inside each tile's scope (cash basis: that
  // money was recognised at pass PURCHASE and is reported as a pass
  // sale on the purchase day — a pass-paid booking still counts as a
  // booking, but contributes ₹0 to these money tiles). One query,
  // three conditional sums; Booking↔Payment is 1:1 so no fan-out.
  const coveredRows = await db.$queryRaw<
    {
      today_revenue_covered: bigint | null;
      total_revenue_covered: bigint | null;
      today_earning_covered: bigint | null;
    }[]
  >(Prisma.sql`
    SELECT
      SUM(CASE WHEN p.status = 'COMPLETED' AND p."confirmedAt" >= ${today} AND p."confirmedAt" < ${tomorrow}
               THEN pr."coveredAmount" ELSE 0 END)::bigint AS today_revenue_covered,
      SUM(CASE WHEN p.status = 'COMPLETED' AND p."confirmedAt" IS NOT NULL
               THEN pr."coveredAmount" ELSE 0 END)::bigint AS total_revenue_covered,
      SUM(CASE WHEN b.date = ${today}
               THEN pr."coveredAmount" ELSE 0 END)::bigint AS today_earning_covered
    FROM "PassRedemption" pr
    INNER JOIN "Booking" b ON b.id = pr."bookingId"
    LEFT JOIN "Payment" p ON p."bookingId" = b.id
    WHERE pr."restoredAt" IS NULL
      AND b.status IN (${Prisma.join([...EARNING_BOOKING_STATUSES])})
  `);
  const covered = coveredRows[0] ?? {
    today_revenue_covered: null,
    total_revenue_covered: null,
    today_earning_covered: null,
  };

  // Gross (pre-discount) earnings = sum(totalAmount) + sum(discountAmount).
  // Booking.originalAmount is only populated when a discount was applied,
  // so we can't just sum it; reconstructing from totalAmount + discount
  // avoids missing the unrelieved-by-discount bookings.
  //
  // This is the one revenue figure that adds money BACK, so closeOut-
  // Booking must not park its uncollected write-off in discountAmount —
  // it would land right back here. See the comment there.
  const grossEarnings =
    (lifetimeEarnings._sum.totalAmount ?? 0) +
    (lifetimeEarnings._sum.discountAmount ?? 0);

  let averageDailyEarning = 0;
  if (firstBooking?.date && grossEarnings > 0) {
    // Inclusive day count: if first booking is today, that's 1 day, not 0.
    const firstDayUtc = Date.UTC(
      firstBooking.date.getUTCFullYear(),
      firstBooking.date.getUTCMonth(),
      firstBooking.date.getUTCDate()
    );
    const todayUtc = Date.UTC(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );
    const days = Math.max(
      1,
      Math.floor((todayUtc - firstDayUtc) / 86_400_000) + 1
    );
    averageDailyEarning = Math.round(grossEarnings / days);
  }

  // Today's earning = sum(Booking.totalAmount) for confirmed bookings
  // whose slot date is today — i.e. the booked revenue for today's
  // sessions, independent of when the customer's payment was
  // confirmed. See the aggregate query above for the rationale.
  // Pass-covered slots contribute ₹0 here — the day still shows the
  // booking in its count, but the money was recognised at pass purchase.
  const todayEarning =
    (todayEarningAgg._sum.totalAmount ?? 0) -
    Number(covered.today_earning_covered ?? 0);

  return {
    isSuperadmin,
    totalBookings: isSuperadmin ? totalBookings : null,
    todayBookings,
    totalUsers,
    todayRevenue: isSuperadmin
      ? (todayRevenue._sum.totalAmount ?? 0) -
        Number(covered.today_revenue_covered ?? 0)
      : null,
    todayEarning: isSuperadmin ? todayEarning : null,
    totalRevenue: isSuperadmin
      ? (totalRevenue._sum.totalAmount ?? 0) -
        Number(covered.total_revenue_covered ?? 0)
      : null,
    pendingPayments,
    venueDueTotal: venueDueAgg._sum.remainingAmount ?? 0,
    averageDailyEarning: isSuperadmin ? averageDailyEarning : null,
  };
}

// ---------------------------------------------------------------------------
// Extended admin booking actions
// ---------------------------------------------------------------------------

import { getSlotPricesForDate } from "@/lib/pricing";
import { zonesOverlap } from "@/lib/court-config";
import { CourtZone } from "@prisma/client";
import { Prisma } from "@prisma/client";

async function requireAdminWithDetails() {
  const user = await requireAdminBase("MANAGE_BOOKINGS");
  const adminUser = await db.adminUser.findFirst({ where: { id: user.id } });
  if (!adminUser) throw new Error("Admin user not found");
  return { id: adminUser.id, username: adminUser.username };
}

// ---------------------------------------------------------------------------
// searchCustomers
// ---------------------------------------------------------------------------
export async function searchCustomers(query: string) {
  await requireAdmin();

  try {
    const customers = await db.user.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { email: { contains: query, mode: "insensitive" } },
          { phone: { contains: query, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, email: true, phone: true },
      take: 10,
    });

    return { success: true as const, customers };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Failed to search customers",
    };
  }
}

// ---------------------------------------------------------------------------
// createCustomerForBooking
// ---------------------------------------------------------------------------
export async function createCustomerForBooking(
  data: {
    name: string;
    phone: string;
    email?: string;
  },
) {
  await requireAdmin();

  try {
    // Client-side PhoneInput already caps at 10 digits, but we normalize
    // + validate here so callers (including any future direct imports)
    // can't store a bare 10-digit number that later gets mis-parsed by
    // MSG91.
    const phone = normalizeIndianPhone(data.phone);
    if (phone.length !== 12 || !phone.startsWith("91")) {
      return {
        success: false as const,
        error: "Phone number must be a 10-digit Indian mobile number",
      };
    }

    // Check if phone already exists
    const existing = await db.user.findUnique({
      where: { phone },
    });
    if (existing) {
      return { success: true as const, userId: existing.id, isNew: false };
    }

    const newUser = await db.user.create({
      data: {
        name: data.name,
        phone,
        email: data.email || null,
        role: "CUSTOMER",
      },
    });

    return { success: true as const, userId: newUser.id, isNew: true };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Failed to create customer",
    };
  }
}

// ---------------------------------------------------------------------------
// reopenNoShowBowlingSlots
// ---------------------------------------------------------------------------
// The 30-min grid comes from `getBowlingMachineAvailability`, which uses
// the CUSTOMER-facing occupancy rule in lib/availability.ts — and that
// one counts ABSENT, so a no-show holds its bowling slot off the admin
// grid forever. The hourly admin paths in this file query bookings
// directly with the narrower OCCUPYING_BOOKING_STATUSES above and can
// already re-sell a no-show's court; this brings the bowling paths in
// line without widening the shared helper (the customer picker feeds
// off the same call and must keep treating ABSENT as sold).
//
// Only "booked" flips, and only when an ABSENT booking is the SOLE
// occupier of that key: a live booking, an in-flight SlotHold or an
// admin SlotBlock on the same key all keep the slot shut. "blocked"
// already outranks "booked" in the helper, so slot blocks need no
// re-check here; holds do, because a key that is both hold-locked and
// ABSENT-booked surfaces as "booked".
async function reopenNoShowBowlingSlots(
  courtConfigId: string,
  dateOnly: Date,
  slots: BowlingSlot[],
  excludeBookingId?: string,
): Promise<BowlingSlot[]> {
  if (!slots.some((s) => s.status === "booked")) return slots;

  const config = await db.courtConfig.findUnique({
    where: { id: courtConfigId },
    select: { zones: true },
  });
  if (!config) return slots;

  const keyOf = (h: number, m: number) => `${h}:${m}`;
  const zoneOverlap = { zones: { hasSome: config.zones as CourtZone[] } };

  const [bookings, holds] = await Promise.all([
    db.booking.findMany({
      where: {
        date: dateOnly,
        status: { in: ["ABSENT", ...OCCUPYING_BOOKING_STATUSES] },
        courtConfig: zoneOverlap,
        ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
      },
      select: {
        status: true,
        slots: {
          select: {
            startHour: true,
            startMinute: true,
            durationMinutes: true,
          },
        },
      },
    }),
    db.slotHold.findMany({
      where: {
        date: dateOnly,
        expiresAt: { gt: new Date() },
        courtConfig: zoneOverlap,
      },
      select: { hours: true, startMinutes: true },
    }),
  ]);

  const absentKeys = new Set<string>();
  const stillOccupied = new Set<string>();
  for (const booking of bookings) {
    const into = booking.status === "ABSENT" ? absentKeys : stillOccupied;
    for (const slot of booking.slots) {
      // An hour-granular turf booking on the overlapping zones takes
      // BOTH halves of its hour — same expansion the helper does.
      if (slot.durationMinutes === 30) {
        into.add(keyOf(slot.startHour, slot.startMinute));
      } else {
        into.add(keyOf(slot.startHour, 0));
        into.add(keyOf(slot.startHour, 30));
      }
    }
  }
  for (const hold of holds) {
    for (let i = 0; i < hold.hours.length; i++) {
      const h = hold.hours[i];
      // Empty startMinutes = a legacy 60-min hold blocking both halves.
      if (hold.startMinutes.length === 0) {
        stillOccupied.add(keyOf(h, 0));
        stillOccupied.add(keyOf(h, 30));
      } else {
        stillOccupied.add(keyOf(h, hold.startMinutes[i] ?? 0));
      }
    }
  }

  return slots.map((slot) => {
    const key = keyOf(slot.hour, slot.minute);
    return slot.status === "booked" &&
      absentKeys.has(key) &&
      !stillOccupied.has(key)
      ? { ...slot, status: "available" as const }
      : slot;
  });
}

// ---------------------------------------------------------------------------
// getAvailableBowlingSlots
// ---------------------------------------------------------------------------
// Wraps the half-hour `getBowlingMachineAvailability` helper for the
// admin edit-slots flow. Same auth + same excludeBookingId hook as
// `getAvailableSlots`; returns 30-min slot entries with `available`
// + `blocked` flags so the modal can render a 30-min grid for
// bowling-machine bookings.
export async function getAvailableBowlingSlots(
  courtConfigId: string,
  dateStr: string,
  excludeBookingId?: string,
) {
  await requireAdmin();

  try {
    const dateOnly = new Date(dateStr + "T00:00:00Z");
    const { getBowlingMachineAvailability } = await import(
      "@/lib/bowling-availability"
    );
    // adminOverride opens up the time-window guards (operating
    // windows + past-time cutoff) so admin sees every 30-min slot
    // of the day, not just the customer-facing window. Conflicts /
    // holds / admin slot blocks stay enforced — they protect real
    // physical resources and matter from the admin side too.
    const raw = await reopenNoShowBowlingSlots(
      courtConfigId,
      dateOnly,
      await getBowlingMachineAvailability(courtConfigId, dateOnly, excludeBookingId, {
        adminOverride: true,
      }),
      excludeBookingId,
    );
    const slots = raw.map((s) => ({
      hour: s.hour,
      minute: s.minute as 0 | 30,
      price: s.price,
      available: s.status === "available",
      blocked: s.status === "blocked" || s.status === "closed",
    }));
    return { success: true as const, slots };
  } catch (error) {
    return {
      success: false as const,
      error:
        error instanceof Error
          ? error.message
          : "Failed to get bowling-machine slots",
    };
  }
}

// ---------------------------------------------------------------------------
// getAvailableSlots
// ---------------------------------------------------------------------------
export async function getAvailableSlots(
  courtConfigId: string,
  dateStr: string,
  excludeBookingId?: string,
) {
  await requireAdmin();

  try {
    const dateOnly = new Date(dateStr + "T00:00:00Z");

    // Get court config
    const config = await db.courtConfig.findUnique({
      where: { id: courtConfigId },
    });
    if (!config) return { success: false as const, error: "Court config not found" };
    if (!config.isActive) return { success: false as const, error: "Court is not active" };

    // Get all active bookings on that date
    const activeBookings = await db.booking.findMany({
      where: {
        date: dateOnly,
        status: { in: [...OCCUPYING_BOOKING_STATUSES] },
        ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
      },
      include: {
        courtConfig: true,
        slots: true,
      },
    });

    // Filter by zone overlap
    const conflicting = activeBookings.filter((b) =>
      zonesOverlap(
        b.courtConfig.zones as CourtZone[],
        config.zones as CourtZone[]
      )
    );

    // Get occupied hours
    const occupiedHours = new Set<number>();
    for (const booking of conflicting) {
      for (const slot of booking.slots) {
        occupiedHours.add(slot.startHour);
      }
    }

    // Get slot blocks for the date
    const blocks = await db.slotBlock.findMany({
      where: {
        date: dateOnly,
        OR: [
          { courtConfigId },
          { sport: config.sport },
          { courtConfigId: null, sport: null },
        ],
      },
    });

    const blockedHours = new Set<number>();
    let fullDayBlocked = false;
    for (const block of blocks) {
      if (block.startHour === null) {
        fullDayBlocked = true;
        break;
      }
      blockedHours.add(block.startHour);
    }

    // Get slot prices
    const slotPrices = await getSlotPricesForDate(courtConfigId, dateOnly);
    const priceMap = new Map<number, number>(slotPrices.map((s) => [s.hour, s.price]));

    // Off-hours (admin-only slots like 2am-5am) aren't covered by the
    // configured pricing rules, so getSlotPricesForDate doesn't return
    // a price for them. Default those to the highest price the venue
    // charges on this dayType — which by business rule is the PEAK
    // rate. Late-night sessions should never undercut peak. Computed
    // as max() across the priced hours rather than a second DB lookup;
    // PricingRule guarantees PEAK ≥ OFF_PEAK so max == PEAK.
    const peakPrice = slotPrices.reduce(
      (max, s) => (s.price > max ? s.price : max),
      0,
    );

    // Admin gets every hour of the calendar day (0..23) — no
    // operating-window cutoff. Front desk often needs to log
    // late-night / early-morning sessions (event bookings,
    // corporate buyouts) that fall outside the customer-facing
    // 5am-1am window. Mirror of the bowling admin path which
    // already emits the full 48 half-hour grid via
    // `adminOverride: true`.
    const slots: { hour: number; price: number; available: boolean; blocked: boolean }[] = [];
    for (let hour = 0; hour < 24; hour++) {
      const blocked = fullDayBlocked || blockedHours.has(hour);
      const occupied = occupiedHours.has(hour);
      slots.push({
        hour,
        price: priceMap.get(hour) ?? peakPrice,
        available: !blocked && !occupied,
        blocked,
      });
    }

    return { success: true as const, slots };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Failed to get available slots",
    };
  }
}

// ---------------------------------------------------------------------------
// adminCreateBooking
// ---------------------------------------------------------------------------
export async function adminCreateBooking(data: {
  courtConfigId: string;
  date: string;
  // Hourly courts (cricket / football / pickleball / etc.) send
  // `hours`. The Bowling Machine 30-min court sends `bowlingSlots`
  // instead and leaves `hours` empty. The two are mutually exclusive;
  // the action picks the path off `config.category === "BOWLING_MACHINE"`
  // (or `slotDurationMinutes === 30`) and rejects mismatched payloads.
  hours: number[];
  bowlingSlots?: Array<{ hour: number; minute: 0 | 30 }>;
  userId: string;
  paymentMethod: "CASH" | "UPI_QR" | "RAZORPAY" | "FREE";
  razorpayPaymentId?: string;
  // Optional advance amount — when > 0 and < totalAmount, the booking is
  // recorded as a partial payment: Payment.isPartialPayment = true,
  // Payment.amount = advanceAmount, remainingAmount = total - advance, and
  // paymentMethod represents HOW the advance was collected (static QR,
  // cash in hand, manual Razorpay, etc.). The remainder is expected in
  // cash at the venue. Cannot combine with FREE.
  advanceAmount?: number;
  // Optional override for the total amount. Admins need this when they've
  // negotiated a price with the customer that differs from the slot-by-slot
  // sum. When set, the computed slot total is preserved on
  // Booking.originalAmount for audit; totalAmount + Payment.amount reflect
  // the negotiated figure. Must be 0 for FREE bookings.
  customTotalAmount?: number;
  // When set, the action re-fetches the coupon row via
  // getActiveSportPromo + applies its discount to the slot-sum.
  // Mutually exclusive with customTotalAmount — admins picking a
  // coupon shouldn't also be free-typing a negotiated price; the
  // action rejects the pair with a clear error. Only PICKLEBALL25
  // is exposed today (anchored to PICKLEBALL via sport-promo helper);
  // future codes will plug in by way of the same lookup.
  applyCouponCode?: string;
  // Book on the customer's pass(es): coverage is computed exactly like
  // customer checkout (multi-pass, band + court-group + validity rules).
  // Full coverage → Payment method PASS / ₹0; partial → the remainder is
  // collected via `paymentMethod`. Incompatible with FREE, custom
  // amounts, coupons and advance splits.
  payWithPass?: boolean;
  // Optional equipment rentals attached at create time. Each entry
  // is {equipmentId, quantity}; the action looks up the live
  // Equipment.pricePerHour (per-slot price; the column name is
  // legacy) and bills quantity * pricePerHour * slotCount, mirroring
  // the post-create EquipmentEditor pricing. Equipment cost rolls
  // into Booking.totalAmount unless customTotalAmount overrides it
  // (admin's negotiated total is treated as inclusive of equipment,
  // same convention the equipment editor uses for negotiated rows).
  equipment?: Array<{ equipmentId: string; quantity: number }>;
  note?: string;
}) {
  const admin = await requireAdminWithDetails();

  try {
    // Validate hours
    const validMethods = ["CASH", "UPI_QR", "RAZORPAY", "FREE"] as const;
    if (!validMethods.includes(data.paymentMethod)) {
      return { success: false as const, error: "Invalid payment method" };
    }
    if (data.advanceAmount !== undefined) {
      if (data.paymentMethod === "FREE") {
        return { success: false as const, error: "Free bookings cannot have a partial payment" };
      }
      if (data.advanceAmount < 0) {
        return { success: false as const, error: "Advance amount cannot be negative" };
      }
    }

    const dateOnly = new Date(data.date + "T00:00:00Z");
    const now = new Date();

    // Get config first — needed before we can validate which slot
    // shape (hours vs bowlingSlots) the payload should carry.
    const config = await db.courtConfig.findUnique({
      where: { id: data.courtConfigId },
    });
    if (!config) return { success: false as const, error: "Court config not found" };
    if (!config.isActive) return { success: false as const, error: "Court is not active" };

    const isBowlingConfig =
      (config.slotDurationMinutes ?? 60) === 30 ||
      config.category === "BOWLING_MACHINE";
    const usingBowling =
      Array.isArray(data.bowlingSlots) && data.bowlingSlots.length > 0;

    if (usingBowling !== isBowlingConfig) {
      return {
        success: false as const,
        error: isBowlingConfig
          ? "This is a Bowling Machine court — pass bowlingSlots[], not hours[]."
          : "This court is hourly — pass hours[], not bowlingSlots[].",
      };
    }

    // Per-slot validation. Hourly path: admin gets the full 24h
    // clock (0..23) plus the legacy hour-24 convention for the
    // 12am-1am-next-morning slot some older bookings store.
    // Customer-facing flow still enforces OPERATING_HOURS via the
    // slot picker on /book; this gate just refuses obviously
    // out-of-range integers. Bowling path enforces {0,30} minute
    // and trusts the availability surface for the start/end
    // window (Bowling Machine has its own operating hours
    // configured via /admin/sports/bowling-machine).
    if (!usingBowling) {
      for (const h of data.hours) {
        if (h < 0 || h > 24) {
          return { success: false as const, error: `Invalid hour: ${h}` };
        }
      }
      if (data.hours.length === 0) {
        return { success: false as const, error: "At least one hour is required" };
      }
    } else {
      for (const s of data.bowlingSlots!) {
        if (s.hour < 0 || s.hour > 23) {
          return { success: false as const, error: `Invalid hour: ${s.hour}` };
        }
        if (s.minute !== 0 && s.minute !== 30) {
          return {
            success: false as const,
            error: `Invalid minute: ${s.minute} (must be 0 or 30)`,
          };
        }
      }
    }

    // Conflict + price gathering. Hourly courts hit the existing
    // zone-overlap path against BookingSlot.startHour; bowling courts
    // re-validate via the half-hour availability helper which already
    // accounts for zone overlap, active holds, blocks, and operating
    // windows. Either branch ends up with a `computedTotal` rupees
    // figure to feed into the existing custom-amount / coupon math.
    let computedTotal: number;
    // priceMap is used by the hourly path to write per-slot prices;
    // bowlingPriceMap is the parallel for the 30-min path. Only one
    // is populated.
    const priceMap = new Map<number, number>();
    const bowlingPriceMap = new Map<string, number>();

    // Off-hours fallback — admin can pick slots outside the venue's
    // configured pricing rules (e.g. 2am). Default those to the
    // venue's PEAK rate (= max of all priced hours by business rule
    // — PEAK ≥ OFF_PEAK). Front desk never undercharges for a
    // late-night session by accident.
    let peakPrice = 0;
    if (!usingBowling) {
      const slotPrices = await getSlotPricesForDate(data.courtConfigId, dateOnly);
      for (const sp of slotPrices) priceMap.set(sp.hour, sp.price);
      peakPrice = slotPrices.reduce(
        (max, s) => (s.price > max ? s.price : max),
        0,
      );

      // Zone-overlap conflict check (same as before)
      const activeBookings = await db.booking.findMany({
        where: {
          date: dateOnly,
          status: { in: [...OCCUPYING_BOOKING_STATUSES] },
        },
        include: { courtConfig: true, slots: true },
      });
      const conflicting = activeBookings.filter((b) =>
        zonesOverlap(
          b.courtConfig.zones as CourtZone[],
          config.zones as CourtZone[]
        )
      );
      const occupiedHours = new Set<number>();
      for (const booking of conflicting) {
        for (const slot of booking.slots) {
          occupiedHours.add(slot.startHour);
        }
      }
      const hourConflicts = data.hours.filter((h) => occupiedHours.has(h));
      if (hourConflicts.length > 0) {
        return { success: false as const, error: `Slots already booked: ${hourConflicts.join(", ")}` };
      }

      // Hour-granular slot blocks
      const blocks = await db.slotBlock.findMany({
        where: {
          date: dateOnly,
          OR: [
            { courtConfigId: data.courtConfigId },
            { sport: config.sport },
            { courtConfigId: null, sport: null },
          ],
        },
      });
      for (const block of blocks) {
        if (block.startHour === null) {
          return { success: false as const, error: "This court is blocked for the entire day" };
        }
        if (data.hours.includes(block.startHour)) {
          return { success: false as const, error: `Slot at hour ${block.startHour} is blocked` };
        }
      }

      computedTotal = data.hours.reduce(
        (sum, h) => sum + (priceMap.get(h) ?? peakPrice),
        0,
      );
    } else {
      // 30-min path. The availability helper enforces conflicts via
      // zone overlap, active holds, and slot blocks — admin
      // overrides the time-window guards (operating windows +
      // past-time) so any 30-min slot of the day is bookable, but
      // can't double-book the physical pitch.
      const { getBowlingMachineAvailability } = await import(
        "@/lib/bowling-availability"
      );
      const avail = await reopenNoShowBowlingSlots(
        config.id,
        dateOnly,
        await getBowlingMachineAvailability(config.id, dateOnly, undefined, {
          adminOverride: true,
        }),
      );
      const keyOf = (h: number, m: number) => `${h}:${m}`;
      const lookup = new Map(
        avail.map((s) => [keyOf(s.hour, s.minute), s] as const),
      );
      for (const s of avail) {
        bowlingPriceMap.set(keyOf(s.hour, s.minute), s.price);
      }

      const conflicts: string[] = [];
      for (const s of data.bowlingSlots!) {
        const entry = lookup.get(keyOf(s.hour, s.minute));
        if (!entry) {
          conflicts.push(`${s.hour}:${s.minute} (closed)`);
          continue;
        }
        if (entry.status !== "available") {
          conflicts.push(`${s.hour}:${s.minute} (${entry.status})`);
        }
      }
      if (conflicts.length > 0) {
        return {
          success: false as const,
          error: `Slots not available: ${conflicts.join(", ")}`,
        };
      }

      computedTotal = data.bowlingSlots!.reduce(
        (sum, s) => sum + (bowlingPriceMap.get(keyOf(s.hour, s.minute)) ?? 0),
        0,
      );
    }

    // Honour the negotiated override when provided. Reject nonsense inputs
    // (non-integers, negatives) and the FREE-but-nonzero combo.
    if (data.customTotalAmount !== undefined) {
      if (!Number.isInteger(data.customTotalAmount) || data.customTotalAmount < 0) {
        return {
          success: false as const,
          error: "Custom amount must be a non-negative integer",
        };
      }
      if (data.paymentMethod === "FREE" && data.customTotalAmount !== 0) {
        return {
          success: false as const,
          error: "Free bookings must have a total of ₹0",
        };
      }
    }

    // ── Coupon application (admin-side) ──────────────────────────────
    // Apply the sport's auto-apply coupon (today only PICKLEBALL25)
    // when admin ticks the checkbox in the form. We re-fetch the
    // active promo via getActiveSportPromo so disabling the coupon in
    // /admin/coupons makes this branch instantly return null, matching
    // the customer-facing rules exactly.
    let couponDiscount = 0;
    let couponRow: Awaited<ReturnType<typeof db.coupon.findUnique>> = null;
    if (data.applyCouponCode) {
      if (data.customTotalAmount !== undefined) {
        return {
          success: false as const,
          error: "Pick either a coupon OR a custom amount, not both",
        };
      }
      if (data.paymentMethod === "FREE") {
        return {
          success: false as const,
          error: "FREE bookings can't carry a coupon",
        };
      }
      // Admins can apply ANY coupon that's valid for this sport, not just
      // the auto-apply promo (they're often honouring a code the customer
      // quotes at the counter). Run the SAME validator the customer path
      // uses so every rule — scope, sport/category filter, window, usage
      // caps, user group, per-user limits — is enforced identically and
      // the discount is computed server-side, never from the client.
      const { validateCoupon } = await import("@/actions/coupon-validation");
      const verdict = await validateCoupon(data.applyCouponCode, {
        scope: "SPORTS",
        amount: computedTotal,
        sport: config.sport,
        bookingCategory: config.category ?? null,
        bookingDate: dateOnly,
        userId: data.userId,
        platform: "web",
      });
      if (!verdict.valid || !verdict.discountAmount) {
        return {
          success: false as const,
          error: verdict.error || "Coupon isn't valid for this booking",
        };
      }
      couponDiscount = verdict.discountAmount;
      // Look up the coupon row in advance so we can record CouponUsage
      // + increment usedCount inside the booking transaction without a
      // second fetch.
      couponRow = await db.coupon.findUnique({
        where: { code: data.applyCouponCode.toUpperCase().trim() },
      });
      if (!couponRow) {
        return {
          success: false as const,
          error: "Coupon row not found",
        };
      }
    }

    // ── Equipment rental pricing ──────────────────────────────────
    // Fetch live Equipment rows for every requested rental, gate on
    // sport / category / isActive, and pre-compute the per-row
    // totalPrice in paise (qty × pricePerHour × slotCount). Pricing
    // mirrors what the post-create EquipmentEditor charges so admin
    // can swap between "add at create" and "add later" without seeing
    // a different number. The rupees figure folds into Booking.
    // equipmentTotalAmount and Booking.totalAmount below.
    type EquipmentResolved = {
      equipmentId: string;
      quantity: number;
      pricePerHourPaise: number;
      totalPricePaise: number;
    };
    const slotCountForEquipment = usingBowling
      ? data.bowlingSlots!.length
      : data.hours.length;
    const resolvedEquipment: EquipmentResolved[] = [];
    if (data.equipment && data.equipment.length > 0) {
      for (const e of data.equipment) {
        if (!Number.isInteger(e.quantity) || e.quantity <= 0) {
          return {
            success: false as const,
            error: "Equipment quantity must be a positive integer",
          };
        }
      }
      const ids = data.equipment.map((e) => e.equipmentId);
      const equipmentRows = await db.equipment.findMany({
        where: { id: { in: ids }, isActive: true },
      });
      const byId = new Map(equipmentRows.map((r) => [r.id, r] as const));
      for (const e of data.equipment) {
        const row = byId.get(e.equipmentId);
        if (!row) {
          return {
            success: false as const,
            error: `Equipment not available: ${e.equipmentId}`,
          };
        }
        resolvedEquipment.push({
          equipmentId: e.equipmentId,
          quantity: e.quantity,
          pricePerHourPaise: row.pricePerHour,
          totalPricePaise: row.pricePerHour * e.quantity * slotCountForEquipment,
        });
      }
    }
    const equipmentTotalPaise = resolvedEquipment.reduce(
      (sum, r) => sum + r.totalPricePaise,
      0,
    );
    const equipmentTotalRupees = Math.round(equipmentTotalPaise / 100);

    // ── Pass payment (booking on the customer's pass balance) ────────
    let passOffer: Awaited<ReturnType<typeof getPassOfferForHold>> = null;
    if (data.payWithPass) {
      if (data.paymentMethod === "FREE") {
        return { success: false as const, error: "FREE bookings can't also use a pass" };
      }
      if (data.customTotalAmount !== undefined) {
        return {
          success: false as const,
          error: "Pass bookings use slot pricing — clear the custom amount",
        };
      }
      if (data.applyCouponCode) {
        return { success: false as const, error: "Passes can't be combined with coupons" };
      }
      if (data.advanceAmount !== undefined) {
        return {
          success: false as const,
          error:
            "Pass bookings can't take an advance split — the pass covers its share and the remainder is collected in full",
        };
      }
      passOffer = await getPassOfferForHold({
        userId: data.userId,
        courtConfigId: data.courtConfigId,
        date: dateOnly,
        hours: usingBowling
          ? data.bowlingSlots!.map((sl) => sl.hour)
          : data.hours,
        startMinutes: usingBowling
          ? data.bowlingSlots!.map((sl) => sl.minute)
          : undefined,
        totalAmount: computedTotal,
        slotPrices: usingBowling
          ? data.bowlingSlots!.map((sl) => ({
              hour: sl.hour,
              minute: sl.minute,
              price: bowlingPriceMap.get(`${sl.hour}:${sl.minute}`) ?? 0,
            }))
          : data.hours.map((h) => ({
              hour: h,
              price: priceMap.get(h) ?? peakPrice,
            })),
        equipmentTotalAmount: equipmentTotalRupees,
        courtConfig: { slotDurationMinutes: usingBowling ? 30 : 60 },
      });
      if (!passOffer) {
        return {
          success: false as const,
          error:
            "None of this customer's passes cover these slots (court, date or price band mismatch, or no balance)",
        };
      }
    }

    // totalAmount = slot subtotal − coupon + equipment, unless
    // customTotalAmount overrides it (admin's negotiated number is
    // treated as the final figure the customer pays, INCLUSIVE of
    // equipment — same convention the post-create equipment editor
    // uses when recomputeBookingTotals derives the final total).
    const totalAmount =
      data.customTotalAmount !== undefined
        ? data.customTotalAmount
        : computedTotal - couponDiscount + equipmentTotalRupees;
    const isCustomAmount =
      data.customTotalAmount !== undefined &&
      data.customTotalAmount !== computedTotal;

    // Normalize partial-payment input once the total is known. A partial
    // amount equal to or greater than the total becomes a normal full
    // payment; anything less creates an advance-with-cash-remainder record.
    // An explicitly-provided 0 is treated as a partial payment (admin
    // is booking without collecting any money upfront) — we distinguish
    // "advance not provided" (undefined) from "0 provided" (explicit zero).
    const advanceProvided = data.advanceAmount !== undefined;
    const rawAdvance = data.advanceAmount ?? 0;
    const isPartial = advanceProvided && rawAdvance < totalAmount;
    const advanceAmount = isPartial ? rawAdvance : undefined;
    const remainingAmount = isPartial ? totalAmount - rawAdvance : undefined;

    // Create in transaction
    const bookingId = await db.$transaction(async (tx) => {
      // Create booking. When the admin negotiated a different total, we
      // stash the slot-sum on originalAmount so the audit view can surface
      // the delta.
      const booking = await tx.booking.create({
        data: {
          userId: data.userId,
          courtConfigId: data.courtConfigId,
          date: dateOnly,
          status: "CONFIRMED",
          totalAmount,
          // Equipment portion in rupees. Stays at 0 when no rentals
          // were picked; admin can still add equipment via the
          // post-create EquipmentEditor and that path will
          // recomputeBookingTotals to reconcile.
          equipmentTotalAmount: equipmentTotalRupees,
          // When admin applied a coupon, the slot-sum was the
          // pre-discount total — stash on originalAmount + record
          // the discount so the audit log / receipts can render
          // "₹800 → ₹600 (25% off via PICKLEBALL25)". The
          // customTotalAmount path keeps its existing semantics.
          originalAmount: isCustomAmount
            ? computedTotal
            : couponDiscount > 0
              ? computedTotal
              : null,
          discountAmount: couponDiscount,
          createdByAdminId: admin.id,
          slots: {
            // Branch on the same `usingBowling` flag set above. Bowling
            // slots carry startMinute (0 or 30) + durationMinutes=30;
            // hourly slots stay on the legacy startMinute=0 +
            // durationMinutes=60 defaults so the BookingSlot index
            // (@@unique([bookingId, startHour, startMinute])) accepts
            // the row exactly as it did before.
            create: usingBowling
              ? data.bowlingSlots!.map((s) => ({
                  startHour: s.hour,
                  startMinute: s.minute,
                  durationMinutes: 30,
                  price: bowlingPriceMap.get(`${s.hour}:${s.minute}`) ?? 0,
                }))
              : data.hours.map((h) => ({
                  startHour: h,
                  price: priceMap.get(h) ?? peakPrice,
                })),
          },
        },
      });

      // Record CouponUsage + bump the global counter so validators
      // honour max-uses on the next booking. Same write the customer
      // checkout flow does in createBookingFromHold, mirrored here so
      // admin-applied coupons count toward usage limits identically.
      if (couponRow && couponDiscount > 0) {
        await tx.couponUsage.create({
          data: {
            couponId: couponRow.id,
            userId: data.userId,
            bookingId: booking.id,
            discountAmount: couponDiscount,
          },
        });
        await tx.coupon.update({
          where: { id: couponRow.id },
          data: { usedCount: { increment: 1 } },
        });
      }

      // Equipment rentals. Created with the already-priced
      // totalPrice (paise) computed above. addBookingEquipment uses
      // the same pricing formula post-create, so the customer pays
      // the same number whether equipment is picked at create time
      // or added later via the EquipmentEditor.
      if (resolvedEquipment.length > 0) {
        await tx.equipmentRental.createMany({
          data: resolvedEquipment.map((r) => ({
            bookingId: booking.id,
            equipmentId: r.equipmentId,
            quantity: r.quantity,
            totalPrice: r.totalPricePaise,
          })),
        });
      }

      // Create payment based on method / partial flag
      if (passOffer && passOffer.fullCoverage) {
        // Fully pass-settled: ₹0 money, same shape the customer
        // redeem route writes. Booking.totalAmount keeps the full slot
        // value; owed-at-venue = total − 0 − coveredAmount = 0.
        await tx.payment.create({
          data: {
            bookingId: booking.id,
            method: "PASS",
            status: "COMPLETED",
            amount: 0,
            confirmedBy: admin.id,
            confirmedAt: now,
          },
        });
      } else if (passOffer) {
        // Pass covers its share; the remainder rides the chosen method
        // (RAZORPAY = already collected, CASH/UPI_QR = due at counter).
        await tx.payment.create({
          data: {
            bookingId: booking.id,
            method: data.paymentMethod,
            status: data.paymentMethod === "RAZORPAY" ? "COMPLETED" : "PENDING",
            amount: passOffer.remainderAmount,
            razorpayPaymentId:
              data.paymentMethod === "RAZORPAY"
                ? (data.razorpayPaymentId ?? null)
                : null,
            ...(data.paymentMethod === "RAZORPAY"
              ? { confirmedBy: admin.id, confirmedAt: now }
              : {}),
          },
        });
      } else if (data.paymentMethod === "FREE") {
        await tx.payment.create({
          data: {
            bookingId: booking.id,
            method: "FREE",
            status: "COMPLETED",
            amount: 0,
            confirmedBy: admin.id,
            confirmedAt: now,
          },
        });
      } else if (isPartial) {
        // Admin confirmed receipt of the advance in the chosen method.
        // Booking is CONFIRMED; status lands on PARTIAL (advance in, rest
        // owed at venue) and flips to COMPLETED via markRemainderCollected
        // once the cash is collected.
        await tx.payment.create({
          data: {
            bookingId: booking.id,
            method: data.paymentMethod,
            status: "PARTIAL",
            amount: advanceAmount!,
            isPartialPayment: true,
            advanceAmount: advanceAmount!,
            remainingAmount: remainingAmount!,
            razorpayPaymentId:
              data.paymentMethod === "RAZORPAY" ? (data.razorpayPaymentId ?? null) : null,
            confirmedBy: admin.id,
            confirmedAt: now,
          },
        });
      } else if (data.paymentMethod === "RAZORPAY") {
        await tx.payment.create({
          data: {
            bookingId: booking.id,
            method: "RAZORPAY",
            status: "COMPLETED",
            amount: totalAmount,
            razorpayPaymentId: data.razorpayPaymentId ?? null,
            confirmedBy: admin.id,
            confirmedAt: now,
          },
        });
      } else {
        // CASH or UPI_QR full payment, admin not yet confirming receipt
        await tx.payment.create({
          data: {
            bookingId: booking.id,
            method: data.paymentMethod,
            status: "PENDING",
            amount: totalAmount,
          },
        });
      }

      // Create edit history. When admin negotiated a different price, fold
      // that into the note so the audit log tells the whole story.
      const creationNotes: string[] = [];
      if (data.note?.trim()) creationNotes.push(data.note.trim());
      if (isCustomAmount) {
        creationNotes.push(
          `Negotiated price: ₹${totalAmount} (computed: ₹${computedTotal})`
        );
      }
      if (couponRow && couponDiscount > 0) {
        creationNotes.push(
          `Applied ${couponRow.code}: -₹${couponDiscount} (₹${computedTotal} → ₹${totalAmount})`,
        );
      }
      if (resolvedEquipment.length > 0) {
        creationNotes.push(
          `Equipment: ${resolvedEquipment.length} item${
            resolvedEquipment.length === 1 ? "" : "s"
          } (₹${equipmentTotalRupees})`,
        );
      }
      if (passOffer) {
        creationNotes.push(
          `Paid with pass — ${passOffer.passes
            .map(
              (sh) =>
                `${sh.passName} (${(sh.coveredMinutes / 60)
                  .toFixed(1)
                  .replace(/\.0$/, "")}h)`,
            )
            .join(" + ")}${
            passOffer.fullCoverage
              ? ""
              : ` · remainder ₹${passOffer.remainderAmount} via ${data.paymentMethod}`
          }`,
        );
      }

      // `newSlots` on BookingEditHistory is an Int[] of start-hours
      // by legacy convention. For bowling we surface the hour list as
      // well so the audit log shows "8, 9" for an 8:00 + 8:30 + 9:00
      // pick — finer-grained detail (the minute) goes into the
      // creation note to keep this column unchanged.
      const auditHours = usingBowling
        ? Array.from(new Set(data.bowlingSlots!.map((s) => s.hour))).sort(
            (a, b) => a - b,
          )
        : data.hours;
      if (usingBowling) {
        creationNotes.push(
          `Bowling slots: ${data.bowlingSlots!
            .map((s) => `${s.hour}:${String(s.minute).padStart(2, "0")}`)
            .join(", ")}`,
        );
      }

      await tx.bookingEditHistory.create({
        data: {
          bookingId: booking.id,
          adminId: admin.id,
          adminUsername: admin.username,
          editType: "CREATED",
          newDate: dateOnly,
          newSlots: auditHours,
          newCourtConfigId: data.courtConfigId,
          newAmount: data.paymentMethod === "FREE" ? 0 : totalAmount,
          note: creationNotes.length > 0 ? creationNotes.join(" · ") : null,
        },
      });

      return booking.id;
    });

    // Settle the pass side — one debit + redemption row per
    // contributing pass, exactly like customer checkout. A failed debit
    // (balance raced away) rolls the whole thing back so the admin can
    // retry with live numbers.
    if (passOffer) {
      let debitFailed = false;
      for (const share of passOffer.passes) {
        const ok = await debitPass(
          share.passId,
          share.coveredMinutes,
          bookingId,
          share.coveredAmount,
          share.coveredSlots,
        );
        if (!ok) {
          debitFailed = true;
          break;
        }
      }
      if (debitFailed) {
        await restorePassForBooking(bookingId).catch(() => {});
        await db.booking.update({
          where: { id: bookingId },
          data: { status: "CANCELLED" },
        });
        return {
          success: false as const,
          error:
            "Pass balance changed while booking — nothing was charged; try again",
        };
      }
    }

    // Send confirmation SMS for bookings whose Payment row landed in a
    // terminal COMPLETED state — FREE, RAZORPAY (full), any partial
    // payment (where admin confirmed receipt of the advance), and
    // fully pass-settled bookings.
    const paymentIsCompleted =
      data.paymentMethod === "FREE" ||
      data.paymentMethod === "RAZORPAY" ||
      isPartial ||
      (!!passOffer && passOffer.fullCoverage);
    if (paymentIsCompleted) {
      after(async () => {
        await Promise.allSettled([
          sendBookingConfirmation(bookingId).catch((err) =>
            console.error("[notify] booking confirmation failed", err),
          ),
          notifyAdminBookingConfirmed(bookingId).catch((err) =>
            console.error("[notify] admin confirmed failed", err),
          ),
        ]);
      });
      // Intentionally no awardBookingPoints call here: admin-created
      // bookings carry Booking.createdByAdminId, and the gate inside
      // awardBookingPoints skips them. The customer didn't make the
      // booking themselves, so they don't earn rewards for it.
    }

    await revalidateBookingPaths(bookingId);

    return { success: true as const, bookingId };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Failed to create booking",
    };
  }
}

// ---------------------------------------------------------------------------
// adminEditBookingSlots
// ---------------------------------------------------------------------------

/**
 * Do two courts charge the same for every hour on a date? PricingRule
 * is per courtConfig, so two courts in the same interchangeable group
 * (sport+size+category) may still be priced differently — only
 * identical pricing makes carrying slot rows across a court move
 * money-neutral.
 */
async function courtsPriceIdentically(
  fromCourtConfigId: string,
  toCourtConfigId: string,
  date: Date,
): Promise<boolean> {
  const [from, to] = await Promise.all([
    getSlotPricesForDate(fromCourtConfigId, date).catch(() => null),
    getSlotPricesForDate(toCourtConfigId, date).catch(() => null),
  ]);
  if (!from || !to || from.length !== to.length) return false;
  const toByHour = new Map(to.map((s) => [s.hour, s.price]));
  return from.every((s) => toByHour.get(s.hour) === s.price);
}

/**
 * The BookingSlot rows an HOURLY edit writes. Hours already on the
 * booking keep their existing rows verbatim — startMinute, duration and
 * price — so a 30-min extension slot (₹0 pass-paid or admin-priced)
 * survives a re-save instead of being inflated into a repriced 60-min
 * row; an unchanged visible selection therefore yields a zero
 * minutes/price delta. Only newly added hours become fresh 60-min rows
 * at the day's rate, and `reprice` (date/court moved) re-rates kept
 * FULL-HOUR rows only — extension prices were set explicitly.
 */
function buildHourlySlotRows(args: {
  existingSlots: {
    startHour: number;
    startMinute: number;
    durationMinutes: number;
    price: number;
  }[];
  newHours: number[];
  priceFor: (hour: number) => number;
  reprice: boolean;
}): {
  startHour: number;
  startMinute: number;
  durationMinutes: number;
  price: number;
}[] {
  const byHour = new Map<number, (typeof args.existingSlots)[number][]>();
  for (const s of args.existingSlots) {
    const list = byHour.get(s.startHour);
    if (list) list.push(s);
    else byHour.set(s.startHour, [s]);
  }
  const rows: {
    startHour: number;
    startMinute: number;
    durationMinutes: number;
    price: number;
  }[] = [];
  const seen = new Set<number>();
  for (const h of args.newHours) {
    if (seen.has(h)) continue; // an hour with two rows (slot + extension) lists once
    seen.add(h);
    const existing = byHour.get(h);
    if (existing) {
      for (const s of existing) {
        rows.push({
          startHour: s.startHour,
          startMinute: s.startMinute,
          durationMinutes: s.durationMinutes,
          price:
            args.reprice && s.durationMinutes === 60
              ? args.priceFor(h)
              : s.price,
        });
      }
    } else {
      rows.push({
        startHour: h,
        startMinute: 0,
        durationMinutes: 60,
        price: args.priceFor(h),
      });
    }
  }
  return rows;
}

export async function adminEditBookingSlots(
  bookingId: string,
  // Hourly picks (cricket / football / pickleball). For bowling-
  // machine bookings, pass `bowlingSlots` instead and leave this
  // empty — the action picks the right path off the courtConfig's
  // slotDurationMinutes.
  newHours: number[],
  // Optional new date for the booking. When provided, the slot grid is
  // re-validated against the target date (availability, blocks, pricing).
  // Passing undefined keeps the booking's current date.
  newDate?: string,
  // Bowling-machine 30-min picks. Each {hour, minute(0|30)} maps to a
  // BookingSlot with startMinute=minute + durationMinutes=30. Mutually
  // exclusive with `newHours`.
  bowlingSlots?: Array<{ hour: number; minute: 0 | 30 }>,
  // Cover ADDED minutes from the customer's pass (the booking's own
  // pass when pass-paid, else their best eligible pass). Validated +
  // debited atomically by syncPassAfterAdminEdit inside the tx.
  coverDeltaWithPass?: boolean,
) {
  const admin = await requireAdminWithDetails();

  try {
    const usingBowling = Array.isArray(bowlingSlots) && bowlingSlots.length > 0;
    if (!usingBowling && newHours.length === 0) {
      return { success: false as const, error: "At least one slot is required" };
    }
    if (!usingBowling) {
      // Admin can edit slots to any hour of the 24h clock. See the
      // create-booking validator above for the rationale.
      for (const h of newHours) {
        if (h < 0 || h > 24) {
          return { success: false as const, error: `Invalid hour: ${h}` };
        }
      }
    } else {
      for (const s of bowlingSlots!) {
        if (s.hour < 0 || s.hour > 23 || (s.minute !== 0 && s.minute !== 30)) {
          return {
            success: false as const,
            error: `Invalid bowling slot: ${s.hour}:${s.minute}`,
          };
        }
      }
    }

    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      include: { slots: true, courtConfig: true, payment: true },
    });

    if (!booking) return { success: false as const, error: "Booking not found" };
    if (booking.status !== "CONFIRMED") {
      return { success: false as const, error: "Only confirmed bookings can be edited" };
    }

    const dateOnly = newDate
      ? new Date(newDate + "T00:00:00Z")
      : booking.date;
    const dateChanged = dateOnly.getTime() !== booking.date.getTime();
    const config = booking.courtConfig;
    const isBowlingConfig =
      (config.slotDurationMinutes ?? 60) === 30 ||
      config.category === "BOWLING_MACHINE";
    if (usingBowling !== isBowlingConfig) {
      return {
        success: false as const,
        error:
          "Slot duration mismatch — pass hours[] for hourly courts, bowlingSlots[] for the bowling machine.",
      };
    }

    let newPreDiscountTotal: number;
    let bowlingPriceMap: Map<string, number> | null = null;
    // The exact rows the hourly path will write — kept-hour rows preserve
    // their duration/price (incl. 30-min extensions) so the minutes/price
    // delta below measures what's actually written.
    let hourlySlotRows:
      | {
          startHour: number;
          startMinute: number;
          durationMinutes: number;
          price: number;
        }[]
      | null = null;

    if (usingBowling) {
      // 30-min path — re-validate via the bowling availability surface
      // for zone overlap + active holds + slot blocks, with this
      // booking dropped from the occupied set. adminOverride bypasses
      // operating-window + past-time guards so admin can move a
      // booking into any 30-min slot of the day.
      const { getBowlingMachineAvailability } = await import(
        "@/lib/bowling-availability"
      );
      const avail = await reopenNoShowBowlingSlots(
        config.id,
        dateOnly,
        await getBowlingMachineAvailability(config.id, dateOnly, bookingId, {
          adminOverride: true,
        }),
        bookingId,
      );
      const keyOf = (h: number, m: number) => `${h}:${m}`;
      const lookup = new Map(
        avail.map((s) => [keyOf(s.hour, s.minute), s] as const),
      );
      bowlingPriceMap = new Map(
        avail.map((s) => [keyOf(s.hour, s.minute), s.price] as const),
      );

      const conflicts: string[] = [];
      for (const s of bowlingSlots!) {
        const entry = lookup.get(keyOf(s.hour, s.minute));
        if (!entry) {
          conflicts.push(`${s.hour}:${s.minute} (closed)`);
          continue;
        }
        if (entry.status !== "available") {
          conflicts.push(`${s.hour}:${s.minute} (${entry.status})`);
        }
      }
      if (conflicts.length > 0) {
        return {
          success: false as const,
          error: `Slots not available: ${conflicts.join(", ")}`,
        };
      }
      newPreDiscountTotal = bowlingSlots!.reduce(
        (sum, s) => sum + (bowlingPriceMap!.get(keyOf(s.hour, s.minute)) ?? 0),
        0,
      );
    } else {
      // Hourly path — original cricket/football/pickleball flow.
      const activeBookings = await db.booking.findMany({
        where: {
          date: dateOnly,
          id: { not: bookingId },
          status: { in: [...OCCUPYING_BOOKING_STATUSES] },
        },
        include: { courtConfig: true, slots: true },
      });
      const conflicting = activeBookings.filter((b) =>
        zonesOverlap(
          b.courtConfig.zones as CourtZone[],
          config.zones as CourtZone[],
        ),
      );
      const occupiedHours = new Set<number>();
      for (const b of conflicting) {
        for (const slot of b.slots) {
          occupiedHours.add(slot.startHour);
        }
      }
      const hourConflicts = newHours.filter((h) => occupiedHours.has(h));
      if (hourConflicts.length > 0) {
        return {
          success: false as const,
          error: `Slots already booked: ${hourConflicts.join(", ")}`,
        };
      }
      const blocks = await db.slotBlock.findMany({
        where: {
          date: dateOnly,
          OR: [
            { courtConfigId: config.id },
            { sport: config.sport },
            { courtConfigId: null, sport: null },
          ],
        },
      });
      for (const block of blocks) {
        if (block.startHour === null) {
          return {
            success: false as const,
            error: "This court is blocked for the entire day",
          };
        }
        if (newHours.includes(block.startHour)) {
          return {
            success: false as const,
            error: `Slot at hour ${block.startHour} is blocked`,
          };
        }
      }
      const slotPrices = await getSlotPricesForDate(config.id, dateOnly);
      const priceMap = new Map<number, number>(
        slotPrices.map((s) => [s.hour, s.price]),
      );
      // Off-hours (admin-only) fall back to PEAK — see the
      // create-booking path for the rationale.
      const peakPriceForEdit = slotPrices.reduce(
        (max, s) => (s.price > max ? s.price : max),
        0,
      );
      hourlySlotRows = buildHourlySlotRows({
        existingSlots: booking.slots,
        newHours,
        priceFor: (h) => priceMap.get(h) ?? peakPriceForEdit,
        reprice: dateChanged,
      });
      newPreDiscountTotal = hourlySlotRows.reduce((sum, r) => sum + r.price, 0);
    }

    // Carry the booking-level discount through, same as
    // adminEditBookingFull. Without this a slot-only edit silently
    // drops a coupon: e.g. trimming one hour off a FLAT100 booking
    // would charge the customer the full new slot total instead of
    // (new total − ₹100).
    let newDiscountAmount = 0;
    if (booking.discountAmount > 0) {
      if (booking.discountCodeId) {
        const code = await db.discountCode.findUnique({
          where: { id: booking.discountCodeId },
          select: { type: true, value: true },
        });
        if (code?.type === "PERCENTAGE") {
          // value is basis points (10000 = 100%) — matches the
          // computation in discount-validation.ts.
          newDiscountAmount = Math.floor(
            (newPreDiscountTotal * code.value) / 10000,
          );
        } else {
          newDiscountAmount = booking.discountAmount;
        }
      } else {
        newDiscountAmount = booking.discountAmount;
      }
      newDiscountAmount = Math.min(newDiscountAmount, newPreDiscountTotal);
    }

    // Booking.totalAmount covers slots AND gear. Rewriting it from the
    // slot prices alone would drop the equipment base — and
    // applyEquipmentDelta (which reprices relative to totalAmount) would
    // then subtract it a second time on the next gear change.
    const equipmentBase = booking.equipmentTotalAmount ?? 0;
    const newTotalAmount =
      Math.max(newPreDiscountTotal - newDiscountAmount, 0) + equipmentBase;
    const newOriginalAmount =
      newDiscountAmount > 0 ? newPreDiscountTotal + equipmentBase : null;

    const previousHours = booking.slots.map((s) => s.startHour).sort((a, b) => a - b);
    const previousAmount = booking.totalAmount;

    // Pass-paid bookings keep their Payment row untouched (₹0 for full
    // coverage, the top-up remainder otherwise) — money truth lives in
    // Payment.amount + PassRedemption.coveredAmount, which the sync
    // below realigns to the new total.
    const liveRedemption = await db.passRedemption.findFirst({
      where: { bookingId, restoredAt: null },
      select: { id: true },
    });
    const isPassCovered =
      !!liveRedemption ||
      booking.payment?.method === "PASS" ||
      // Top-up bookings stay pass-covered even after their redemption is
      // restored — Payment.amount is the captured remainder, never the
      // slot total.
      booking.payment?.confirmedBy === "PASS_TOPUP";
    const oldBookedMinutes = booking.slots.reduce(
      (sum, s) => sum + s.durationMinutes,
      0,
    );
    // Measure minutes from the rows actually written — kept extension
    // slots stay 30 min, so an unchanged selection yields delta 0.
    const newBookedMinutes = usingBowling
      ? bowlingSlots!.length * 30
      : hourlySlotRows!.reduce((sum, r) => sum + r.durationMinutes, 0);
    const effectiveNewHours = usingBowling
      ? bowlingSlots!.map((s) => s.hour).sort((a, b) => a - b)
      : newHours;
    // Which rows this save ADDS — at SLOT granularity, so the bowling
    // 30-min grid is handled too (adding 14:30 to a booking that already
    // holds 14:00 is a real addition even though the hour is unchanged).
    // The sync band-checks the added hours and refuses to draw pass
    // coverage from rows the pass was never debited for.
    const bookedSlotKeys = new Set(
      booking.slots.map((s) => `${s.startHour}:${s.startMinute}`),
    );
    const newSlotsForPass = usingBowling
      ? bowlingSlots!.map((sl) => ({
          startHour: sl.hour,
          startMinute: sl.minute,
          durationMinutes: 30,
          price: bowlingPriceMap!.get(`${sl.hour}:${sl.minute}`) ?? 0,
          isNew: !bookedSlotKeys.has(`${sl.hour}:${sl.minute}`),
        }))
      : hourlySlotRows!.map((r) => ({
          startHour: r.startHour,
          startMinute: r.startMinute,
          durationMinutes: r.durationMinutes,
          price: r.price,
          isNew: !bookedSlotKeys.has(`${r.startHour}:${r.startMinute}`),
        }));
    // Gate on added ROWS, not a net minute increase — a swap adds a slot
    // the pass must pay for even though the total is unchanged. A stale
    // tick on a pure REMOVAL still can't cover anything (no new rows).
    const coverDelta = shouldCoverDelta(coverDeltaWithPass, newSlotsForPass);

    await db.$transaction(async (tx) => {
      // Delete old slots
      await tx.bookingSlot.deleteMany({ where: { bookingId } });

      // Create new slots — 30-min entries for bowling-machine bookings,
      // hour entries for everything else. Each row carries startMinute
      // + durationMinutes so the new BookingSlot.startMinute index
      // (introduced for bowling) stays consistent across paths.
      if (usingBowling) {
        const keyOf = (h: number, m: number) => `${h}:${m}`;
        await tx.bookingSlot.createMany({
          data: bowlingSlots!.map((s) => ({
            bookingId,
            startHour: s.hour,
            startMinute: s.minute,
            durationMinutes: 30,
            price: bowlingPriceMap!.get(keyOf(s.hour, s.minute)) ?? 0,
          })),
        });
      } else {
        await tx.bookingSlot.createMany({
          data: hourlySlotRows!.map((r) => ({ bookingId, ...r })),
        });
      }

      // Update booking total + discount fields and (if the admin moved
      // it) the date. originalAmount/discountAmount are rewritten so a
      // partial-court customer who edits down doesn't see a stale
      // strike-through pill referencing the old slot configuration.
      const bookingPatch: {
        totalAmount: number;
        originalAmount: number | null;
        discountAmount: number;
        date?: Date;
      } = {
        totalAmount: newTotalAmount,
        originalAmount: newOriginalAmount,
        discountAmount: newDiscountAmount,
      };
      if (dateChanged) bookingPatch.date = dateOnly;
      await tx.booking.update({
        where: { id: bookingId },
        data: bookingPatch,
      });

      // Update payment amount if exists. Partial-payment bookings keep
      // their advance untouched here (adminEditBookingFull owns editing
      // it) — only their remainder is re-derived, further below, once the
      // pass sync has reported what it covers. Pass-covered bookings are also
      // left alone — their Payment.amount is the money actually captured
      // (0 or the top-up remainder), never the slot total. Same when the
      // admin asked a pass to cover the delta: overwriting to the new
      // total would fabricate captured revenue and zero the redemption's
      // coveredAmount below.
      if (
        booking.payment &&
        !booking.payment.isPartialPayment &&
        !isPassCovered &&
        !coverDelta
      ) {
        await tx.payment.update({
          where: { id: booking.payment.id },
          data: { amount: newTotalAmount },
        });
      }

      // Keep the pass ledger coherent with the new slots: debit added
      // minutes when requested (validating balance/court/date), credit
      // removed minutes back, and realign coveredAmount so
      // owed-at-venue = total − payment − covered stays exact.
      {
        const paymentAfterEdit = booking.payment
          ? booking.payment.isPartialPayment || isPassCovered || coverDelta
            ? booking.payment.amount
            : newTotalAmount
          : 0;
        const passSync = await syncPassAfterAdminEdit(tx, {
          bookingId,
          bookingUserId: booking.userId,
          bookingDate: dateChanged ? dateOnly! : booking.date,
          courtConfigId: booking.courtConfigId,
          newTotalAmount,
          paymentAmount: paymentAfterEdit,
          // The rows this edit actually wrote, each flagged as pre-existing
          // or newly added — the sync draws the pass's share only from
          // rows it legitimately paid for.
          newSlots: newSlotsForPass,
          equipmentAmount: equipmentBase,
          coverDeltaWithPass: coverDelta,
        });
        if (!passSync.ok) throw new Error(passSync.error);

        // The advance is what it always was, but the venue-side balance
        // has to follow the new total — left stale, Payment.remainingAmount
        // keeps quoting the pre-edit figure and the "Cash Due at Venue" KPI
        // (a straight _sum over Payment) over-reports forever. Anything a
        // pass settled isn't collectable at the venue, and pass-covered
        // bookings are skipped entirely (same gate adminEditBookingFull
        // uses) — their balance is owned by the redemption's coveredAmount.
        //
        // Derived from Payment.amount, NOT advanceAmount: markRemainderCollected
        // leaves isPartialPayment = true after settling the balance, so the
        // flag alone doesn't mean money is still owed. Payment.amount is what
        // actually came in in both states (it equals the advance while still
        // PARTIAL, and advance + collected afterwards), so a booking whose
        // remainder the venue already took isn't billed for it twice.
        if (booking.payment?.isPartialPayment && !isPassCovered) {
          await tx.payment.update({
            where: { id: booking.payment.id },
            data: {
              remainingAmount: Math.max(
                0,
                newTotalAmount -
                  booking.payment.amount -
                  passSync.coveredAmount,
              ),
            },
          });
        }
      }

      // Emit a date-change entry first so the history stays chronologically
      // readable when both changed in the same save.
      if (dateChanged) {
        await tx.bookingEditHistory.create({
          data: {
            bookingId,
            adminId: admin.id,
            adminUsername: admin.username,
            editType: "DATE_CHANGED",
            previousDate: booking.date,
            newDate: dateOnly,
            previousSlots: previousHours,
            newSlots: effectiveNewHours,
            previousAmount,
            newAmount: newTotalAmount,
          },
        });
      }

      const sortedNewHours = [...effectiveNewHours].sort((a, b) => a - b);
      const slotsChanged =
        previousHours.length !== sortedNewHours.length ||
        previousHours.some((h, i) => h !== sortedNewHours[i]);
      if (slotsChanged) {
        await tx.bookingEditHistory.create({
          data: {
            bookingId,
            adminId: admin.id,
            adminUsername: admin.username,
            editType: "SLOTS_CHANGED",
            previousSlots: previousHours,
            newSlots: effectiveNewHours,
            previousAmount,
            newAmount: newTotalAmount,
          },
        });
      }
    });

    // Slot count just changed — rental totals on every EquipmentRental
    // attached to this booking are still computed against the OLD slot
    // count. Re-price them so the booking total reflects the new
    // multiplier (e.g. 2 slots → 3 slots bumps a ₹100/slot rental
    // from ₹200 to ₹300).
    const { repriceBookingEquipment } = await import(
      "@/actions/admin-equipment-rental"
    );
    await repriceBookingEquipment(bookingId);

    await revalidateBookingPaths(bookingId);

    // Compute the slots that were FREED on the old date so we can
    // notify waitlisters. If the date changed, every previously held
    // hour on booking.date is freed (none of them survive on that
    // date). Otherwise only hours not in the new selection are freed.
    const newHourSet = new Set(effectiveNewHours);
    const freedHours = dateChanged
      ? previousHours
      : previousHours.filter((h) => !newHourSet.has(h));
    if (freedHours.length > 0) {
      after(async () => {
        await notifyWaitlistersForFreedSlots({
          courtConfigId: booking.courtConfigId,
          date: booking.date, // OLD date — booking was loaded pre-tx
          hours: freedHours,
        }).catch((err) =>
          console.error("[waitlist] freed-slot fan-out failed", err),
        );
      });
    }

    // Tell the customer — fire-and-forget, never blocks the operation.
    void notifyBookingActivity(bookingId, "SLOTS_CHANGED");

    return { success: true as const };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Failed to edit booking slots",
    };
  }
}

// ---------------------------------------------------------------------------
// adminEditBookingFull
// ---------------------------------------------------------------------------
export async function adminEditBookingFull(
  bookingId: string,
  data: {
    newDate?: string;
    newCourtConfigId?: string;
    newHours?: number[];
    // Partial-payment edits. Admin can correct the advance figure after the
    // booking is created (e.g. customer rounded up or paid a different
    // amount than originally recorded) or change the method (e.g. recorded
    // as Cash, actually came in via static QR).
    newAdvanceAmount?: number;
    newAdvanceMethod?: "CASH" | "UPI_QR";
    // Cover ADDED minutes from the customer's pass (validated + debited
    // atomically inside the tx by syncPassAfterAdminEdit).
    coverDeltaWithPass?: boolean;
  },
) {
  const admin = await requireAdminWithDetails();

  try {
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      include: { slots: true, courtConfig: true, payment: true },
    });

    if (!booking) return { success: false as const, error: "Booking not found" };
    if (booking.status !== "CONFIRMED") {
      return { success: false as const, error: "Only confirmed bookings can be edited" };
    }
    // Customer-created bookings paid via gateway are now editable too
    // (e.g. customer asks to switch from full court to half) — see the
    // payment-amount branch below for how we keep the captured-amount
    // record intact while still letting the booking total change.

    // Determine final values
    const finalDate = data.newDate
      ? new Date(data.newDate + "T00:00:00Z")
      : booking.date;
    const finalCourtConfigId = data.newCourtConfigId ?? booking.courtConfigId;
    // Deduped: a booking with a full-hour slot AND a 30-min extension in
    // the same hour maps to one visible hour (both rows are preserved by
    // the slot-row builder below).
    const finalHours = [
      ...new Set(data.newHours ?? booking.slots.map((s) => s.startHour)),
    ];

    // Validate hours — admin gets the full 24h clock; see the
    // create-booking validator earlier in this file for the
    // rationale on the 0..24 inclusive range.
    for (const h of finalHours) {
      if (h < 0 || h > 24) {
        return { success: false as const, error: `Invalid hour: ${h}` };
      }
    }
    if (finalHours.length === 0) {
      return { success: false as const, error: "At least one hour is required" };
    }

    // Get final config
    const finalConfig = finalCourtConfigId === booking.courtConfigId
      ? booking.courtConfig
      : await db.courtConfig.findUnique({ where: { id: finalCourtConfigId } });

    if (!finalConfig) return { success: false as const, error: "Court config not found" };
    if (!finalConfig.isActive) return { success: false as const, error: "Court is not active" };
    // Bowling-machine bookings live on a 30-min grid this hourly editor
    // would corrupt into hour rows (and moving an hourly booking ONTO
    // the machine needs 30-min picks it can't express). The slot editor
    // (adminEditBookingSlots + bowlingSlots) owns that grid.
    if (
      (finalConfig.slotDurationMinutes ?? 60) === 30 ||
      finalConfig.category === "BOWLING_MACHINE"
    ) {
      return {
        success: false as const,
        error:
          "Bowling-machine bookings use the 30-min slot editor — edit slots there instead.",
      };
    }

    // Check availability excluding current booking
    const activeBookings = await db.booking.findMany({
      where: {
        date: finalDate,
        id: { not: bookingId },
        status: { in: [...OCCUPYING_BOOKING_STATUSES] },
      },
      include: { courtConfig: true, slots: true },
    });

    const conflicting = activeBookings.filter((b) =>
      zonesOverlap(
        b.courtConfig.zones as CourtZone[],
        finalConfig.zones as CourtZone[]
      )
    );

    const occupiedHours = new Set<number>();
    for (const b of conflicting) {
      for (const slot of b.slots) {
        occupiedHours.add(slot.startHour);
      }
    }

    const hourConflicts = finalHours.filter((h) => occupiedHours.has(h));
    if (hourConflicts.length > 0) {
      return { success: false as const, error: `Slots already booked: ${hourConflicts.join(", ")}` };
    }

    // Check slot blocks
    const blocks = await db.slotBlock.findMany({
      where: {
        date: finalDate,
        OR: [
          { courtConfigId: finalCourtConfigId },
          { sport: finalConfig.sport },
          { courtConfigId: null, sport: null },
        ],
      },
    });

    for (const block of blocks) {
      if (block.startHour === null) {
        return { success: false as const, error: "This court is blocked for the entire day" };
      }
      if (finalHours.includes(block.startHour)) {
        return { success: false as const, error: `Slot at hour ${block.startHour} is blocked` };
      }
    }

    // Get new prices
    const slotPrices = await getSlotPricesForDate(finalCourtConfigId, finalDate);
    const priceMap = new Map<number, number>(slotPrices.map((s) => [s.hour, s.price]));
    // Off-hours (admin-only) fall back to PEAK — see create-booking
    // path for the rationale.
    const peakPriceForBookingEdit = slotPrices.reduce(
      (max, s) => (s.price > max ? s.price : max),
      0,
    );
    // Kept hours preserve their existing rows (a 30-min extension keeps
    // its duration + explicitly-set price); only fresh hours become
    // 60-min rows, repriced on a date move. Moving to a court in a
    // DIFFERENT group re-bases every hour as a fresh 60-min row on the
    // new court's pricing — durations/prices carried from another court
    // (e.g. the bowling machine's 30-min grid) aren't meaningful there.
    // A move WITHIN the group (cricket LEFT → RIGHT) is the same product
    // at the same price, so rows carry over untouched — otherwise a
    // 30-min extension would silently inflate into a full-price hour.
    // Preserve rows only when the destination court PRICES the same —
    // court-group membership (sport+size+category) doesn't guarantee it,
    // since PricingRule is per courtConfig. Same prices ⇒ carrying the
    // rows over is a no-op for money and keeps 30-min extensions
    // intact; different prices ⇒ re-base so totalAmount reflects the
    // destination court.
    const courtChangedForRows =
      finalCourtConfigId !== booking.courtConfigId &&
      !(await courtsPriceIdentically(
        booking.courtConfigId,
        finalCourtConfigId,
        finalDate,
      ));
    const newSlotRows = buildHourlySlotRows({
      existingSlots: courtChangedForRows ? [] : booking.slots,
      newHours: finalHours,
      priceFor: (h) => priceMap.get(h) ?? peakPriceForBookingEdit,
      reprice: finalDate.getTime() !== booking.date.getTime(),
    });
    const newPreDiscountTotal = newSlotRows.reduce(
      (sum, r) => sum + r.price,
      0,
    );

    // Carry the existing booking-level discount through to the new
    // total. Without this step, switching from full → half court drops
    // the customer's coupon discount on the floor: e.g. a ₹2000 booking
    // with FLAT100 (₹1900 charged) edited to a ₹1200 half court would
    // bill the customer ₹1200 instead of the correct ₹1100.
    //
    // We recompute against the new pre-discount total so PERCENTAGE
    // coupons stay proportional, and preserve the absolute amount for
    // FLAT coupons (and admin-applied custom discounts where
    // discountCodeId is null). The discount is always capped at the
    // new pre-discount total to avoid negative totals on shrinkage.
    let newDiscountAmount = 0;
    if (booking.discountAmount > 0) {
      if (booking.discountCodeId) {
        const code = await db.discountCode.findUnique({
          where: { id: booking.discountCodeId },
          select: { type: true, value: true },
        });
        if (code?.type === "PERCENTAGE") {
          // value is basis points (10000 = 100%), matching how
          // discount-validation.ts computes it at booking time.
          newDiscountAmount = Math.floor(
            (newPreDiscountTotal * code.value) / 10000,
          );
        } else {
          // FLAT (or coupon row deleted): preserve the absolute amount.
          newDiscountAmount = booking.discountAmount;
        }
      } else {
        // No coupon row — treat as a pre-existing flat admin discount.
        newDiscountAmount = booking.discountAmount;
      }
      newDiscountAmount = Math.min(newDiscountAmount, newPreDiscountTotal);
    }

    // Slots AND gear — see the slots editor: dropping the equipment base
    // here would make the next applyEquipmentDelta subtract it twice.
    const equipmentBaseFull = booking.equipmentTotalAmount ?? 0;
    const newTotalAmount =
      Math.max(newPreDiscountTotal - newDiscountAmount, 0) + equipmentBaseFull;
    // originalAmount tracks the pre-discount slot total whenever a
    // discount is applied, so the UI can render the strike-through
    // "₹X" alongside the actual charge. Null it out if the new total
    // is undiscounted (e.g. a FLAT coupon was capped to zero by a
    // tiny new total).
    const newOriginalAmount =
      newDiscountAmount > 0 ? newPreDiscountTotal + equipmentBaseFull : null;

    const previousHours = booking.slots.map((s) => s.startHour).sort((a, b) => a - b);
    const previousAmount = booking.totalAmount;

    // Advance edits only apply to existing partial payments that haven't
    // had the remainder collected yet. Reject if caller asked for changes
    // but the booking isn't in that state.
    const isEditingAdvance =
      data.newAdvanceAmount !== undefined || data.newAdvanceMethod !== undefined;
    if (isEditingAdvance) {
      if (!booking.payment || !booking.payment.isPartialPayment) {
        return { success: false as const, error: "Booking is not a partial payment" };
      }
      if (booking.payment.status !== "PARTIAL") {
        return { success: false as const, error: "Advance can only be edited while payment is PARTIAL" };
      }
    }

    const previousAdvance = booking.payment?.advanceAmount ?? null;
    const previousAdvanceMethod = booking.payment?.method ?? null;

    const finalAdvance =
      data.newAdvanceAmount !== undefined
        ? data.newAdvanceAmount
        : previousAdvance;
    const finalAdvanceMethod =
      data.newAdvanceMethod !== undefined
        ? data.newAdvanceMethod
        : previousAdvanceMethod;

    if (isEditingAdvance) {
      // 0 is a valid advance — admin uses it to mark a booking as
      // "no advance, collect everything at venue" while keeping the
      // payment record intact. Mirrors the create flow's validation
      // (createAdminBooking allows advanceAmount === 0). Reject only
      // null / non-integer / negative.
      if (finalAdvance === null || !Number.isInteger(finalAdvance) || finalAdvance < 0) {
        return { success: false as const, error: "Advance must be a non-negative integer" };
      }
      if (finalAdvance >= newTotalAmount) {
        return { success: false as const, error: "Advance must be less than the total amount" };
      }
    }

    await db.$transaction(async (tx) => {
      // Update booking. We rewrite originalAmount alongside totalAmount
      // because the previous originalAmount referred to the OLD slot
      // configuration (e.g. ₹2000 full court); after a court swap that
      // figure is misleading. Setting it from `newOriginalAmount`
      // keeps the strike-through "₹X" pill in the UI accurate, or
      // clears it when no discount applies post-edit.
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          date: finalDate,
          courtConfigId: finalCourtConfigId,
          totalAmount: newTotalAmount,
          originalAmount: newOriginalAmount,
          discountAmount: newDiscountAmount,
        },
      });

      // Delete old slots, create new — explicit startMinute/duration so
      // 30-min extension rows survive and nothing rides schema defaults.
      await tx.bookingSlot.deleteMany({ where: { bookingId } });
      await tx.bookingSlot.createMany({
        data: newSlotRows.map((r) => ({ bookingId, ...r })),
      });

      // Update payment amount / advance fields if payment exists.
      //
      // Three cases:
      //
      //  1. Partial-payment edit (admin tweaks advance / method).
      //     Keep `amount` synced with advanceAmount as today.
      //
      //  2. Admin-created cash booking that's been edited.
      //     Payment.amount tracks "what was collected", admin can
      //     adjust freely → overwrite with the new total. Same as
      //     the previous behavior.
      //
      //  3. Customer booking paid via gateway (Razorpay / PhonePe /
      //     UPI QR / FREE), now being edited.
      //     Payment.amount is the captured amount on the gateway side
      //     (or the recorded UTR / coupon-zero) — overwriting it
      //     would lose the audit trail. Leave Payment.amount alone;
      //     Booking.totalAmount carries the new value, and the UI
      //     shows the delta as either "refund due to customer" or
      //     "collect ₹X extra at venue". If the new total exceeds the
      //     captured amount, flip the payment to PARTIAL with the
      //     remainder so existing partial-payment UX kicks in.
      // Pass-covered bookings (live PassRedemption or method PASS) keep
      // their Payment row exactly as captured: ₹0 for full coverage or
      // the top-up remainder. Flipping them PARTIAL (case 3) or
      // overwriting amount would double-charge the covered hours — the
      // pass sync below realigns coveredAmount instead, so
      // owed-at-venue = total − payment − covered stays exact.
      const liveRedemptionFull = await tx.passRedemption.findFirst({
        where: { bookingId, restoredAt: null },
        select: { id: true },
      });
      const isPassCoveredFull =
        !!liveRedemptionFull ||
        booking.payment?.method === "PASS" ||
        // Top-up bookings stay pass-covered even once the redemption is
        // restored — Payment.amount is the captured remainder, never the
        // slot total.
        booking.payment?.confirmedBy === "PASS_TOPUP";

      // The sync runs FIRST so the payment write below knows how much of
      // the new total a pass just settled — a partial booking's
      // "collect at venue" figure must exclude the covered delta.
      const oldMinFull = booking.slots.reduce((s, x) => s + x.durationMinutes, 0);
      // Measure what's actually written — kept extension rows stay
      // 30 min, so an unchanged selection yields delta 0.
      const newMinFull = newSlotRows.reduce((s, r) => s + r.durationMinutes, 0);
      // A stale tick from a selection later changed into a removal has
      // no added time to cover.
      const bookedSlotKeysFull = new Set(
        booking.slots.map((x) => `${x.startHour}:${x.startMinute}`),
      );
      const newSlotsForPassFull = newSlotRows.map((r) => ({
        startHour: r.startHour,
        startMinute: r.startMinute,
        durationMinutes: r.durationMinutes,
        price: r.price,
        isNew: !bookedSlotKeysFull.has(`${r.startHour}:${r.startMinute}`),
      }));
      const coverDeltaFull = shouldCoverDelta(
        data.coverDeltaWithPass,
        newSlotsForPassFull,
      );
      // markRemainderCollected settles the balance but deliberately leaves
      // isPartialPayment = true, so that flag alone doesn't mean money is
      // still owed. Once the venue has collected, the advance is no longer
      // the money received — Payment.amount is — and rewriting amount back
      // down to the advance would erase the collection from the books.
      const remainderOutstanding = booking.payment?.status === "PARTIAL";
      // Mirrors the paymentUpdate branch order below so the sync sees
      // exactly the Payment.amount the edit leaves behind.
      const paymentAfterEdit = booking.payment
        ? isPassCoveredFull
          ? booking.payment.amount
          : booking.payment.isPartialPayment && finalAdvance !== null
            ? remainderOutstanding
              ? finalAdvance
              : booking.payment.amount
            : coverDeltaFull
              ? booking.payment.amount
              : booking.createdByAdminId
                ? newTotalAmount
                : booking.payment.amount
        : 0;
      const passSync = await syncPassAfterAdminEdit(tx, {
        bookingId,
        bookingUserId: booking.userId,
        bookingDate: finalDate,
        courtConfigId: finalCourtConfigId,
        newTotalAmount,
        paymentAmount: paymentAfterEdit,
        newSlots: newSlotsForPassFull,
        equipmentAmount: equipmentBaseFull,
        coverDeltaWithPass: coverDeltaFull,
      });
      if (!passSync.ok) throw new Error(passSync.error);
      const passCovered = passSync.coveredAmount;

      if (booking.payment && !isPassCoveredFull) {
        const paymentUpdate: {
          amount?: number;
          advanceAmount?: number;
          remainingAmount?: number;
          method?: "CASH" | "UPI_QR";
          isPartialPayment?: boolean;
        } = {};

        if (booking.payment.isPartialPayment && finalAdvance !== null) {
          // Only re-stamp the advance while the remainder is still owed —
          // see remainderOutstanding above. Post-collection the money
          // received is Payment.amount, so the balance is derived from
          // that instead and comes out at 0 for an unchanged total rather
          // than re-billing the customer for what they already paid.
          const received = remainderOutstanding
            ? finalAdvance
            : booking.payment.amount;
          if (remainderOutstanding) {
            paymentUpdate.amount = finalAdvance;
            paymentUpdate.advanceAmount = finalAdvance;
          }
          // Anything a pass just settled isn't collectable at the venue.
          paymentUpdate.remainingAmount = Math.max(
            0,
            newTotalAmount - received - passCovered,
          );
        } else if (coverDeltaFull) {
          // A pass settles the added time — keep the collected/captured
          // figure intact (no fabricated revenue) and don't flip PARTIAL
          // demanding money nobody owes; the sync below records the
          // covered remainder on the redemption instead.
        } else if (booking.createdByAdminId) {
          // Admin-created cash flow — case (2).
          paymentUpdate.amount = newTotalAmount;
        } else {
          // Case (3): customer paid via gateway. Don't touch
          // Payment.amount. If the booking just got more expensive,
          // flip to PARTIAL so "Collect ₹X at venue" surfaces.
          const captured = booking.payment.amount;
          if (newTotalAmount > captured) {
            paymentUpdate.isPartialPayment = true;
            paymentUpdate.advanceAmount = captured;
            paymentUpdate.remainingAmount = newTotalAmount - captured;
          }
          // If newTotal <= captured, leave Payment as-is. UI shows
          // a "Refund ₹delta due" pill that admin reconciles via the
          // gateway dashboard (or refundBooking later).
        }

        if (data.newAdvanceMethod) {
          paymentUpdate.method = data.newAdvanceMethod;
        }

        if (Object.keys(paymentUpdate).length > 0) {
          await tx.payment.update({
            where: { id: booking.payment.id },
            data: paymentUpdate,
          });
        }
      }

      // Create edit history entries for each change type
      if (data.newDate && finalDate.getTime() !== booking.date.getTime()) {
        await tx.bookingEditHistory.create({
          data: {
            bookingId,
            adminId: admin.id,
            adminUsername: admin.username,
            editType: "DATE_CHANGED",
            previousDate: booking.date,
            newDate: finalDate,
            previousSlots: previousHours,
            newSlots: finalHours,
            previousAmount,
            newAmount: newTotalAmount,
          },
        });
      }

      if (data.newCourtConfigId && finalCourtConfigId !== booking.courtConfigId) {
        await tx.bookingEditHistory.create({
          data: {
            bookingId,
            adminId: admin.id,
            adminUsername: admin.username,
            editType: "COURT_CHANGED",
            previousCourtConfigId: booking.courtConfigId,
            newCourtConfigId: finalCourtConfigId,
            previousSlots: previousHours,
            newSlots: finalHours,
            previousAmount,
            newAmount: newTotalAmount,
          },
        });
      }

      if (data.newHours) {
        const sortedPrevious = [...previousHours].sort((a, b) => a - b);
        const sortedNew = [...finalHours].sort((a, b) => a - b);
        const slotsChanged =
          sortedPrevious.length !== sortedNew.length ||
          sortedPrevious.some((h, i) => h !== sortedNew[i]);

        if (slotsChanged) {
          await tx.bookingEditHistory.create({
            data: {
              bookingId,
              adminId: admin.id,
              adminUsername: admin.username,
              editType: "SLOTS_CHANGED",
              previousSlots: previousHours,
              newSlots: finalHours,
              previousAmount,
              newAmount: newTotalAmount,
            },
          });
        }
      }

      if (isEditingAdvance) {
        const amountChanged =
          data.newAdvanceAmount !== undefined &&
          data.newAdvanceAmount !== previousAdvance;
        const methodChanged =
          data.newAdvanceMethod !== undefined &&
          data.newAdvanceMethod !== previousAdvanceMethod;
        if (amountChanged || methodChanged) {
          const parts: string[] = [];
          if (amountChanged) {
            parts.push(`advance ${previousAdvance ?? "?"} → ${finalAdvance}`);
          }
          if (methodChanged) {
            parts.push(`method ${previousAdvanceMethod ?? "?"} → ${finalAdvanceMethod}`);
          }
          await tx.bookingEditHistory.create({
            data: {
              bookingId,
              adminId: admin.id,
              adminUsername: admin.username,
              editType: "ADVANCE_CHANGED",
              previousAmount,
              newAmount: newTotalAmount,
              note: parts.join(" · "),
            },
          });
        }
      }
    });

    await revalidateBookingPaths(bookingId);

    return { success: true as const };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Failed to edit booking",
    };
  }
}

// ---------------------------------------------------------------------------
// getBookingEditHistory
// ---------------------------------------------------------------------------
export async function getBookingEditHistory(bookingId: string) {
  await requireAdmin();

  try {
    const history = await db.bookingEditHistory.findMany({
      where: { bookingId },
      orderBy: { createdAt: "desc" },
    });

    return { success: true as const, history };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Failed to get edit history",
    };
  }
}

// ---------------------------------------------------------------------------
// recoverRazorpayPayment — admin recovery tool
// ---------------------------------------------------------------------------

export interface RecoverRazorpayResult {
  success: boolean;
  /** "created" — new Booking made from the captured payment.
   *  "already-linked" — a Booking already exists for this paymentId.
   *  "no-hold" — payment captured but no matching SlotHold; admin
   *  needs to use the manual "+ New Booking" path. */
  state?: "created" | "already-linked" | "no-hold";
  bookingId?: string;
  payment?: {
    id: string;
    orderId: string;
    amountRupees: number;
    status: string;
    captured: boolean;
    contact: string | null;
    email: string | null;
    createdAt: number;
  };
  error?: string;
}

/**
 * Look up a captured Razorpay payment and create the matching Booking
 * if our DB is missing it. Use case: a customer paid via Razorpay,
 * the client's verify call dropped (network blip / closed tab), and
 * the slot stayed blocked while no Booking row was created. Admin
 * pastes the Razorpay paymentId here and we reconstruct the booking
 * from the SlotHold we stamped with the orderId at create-order time.
 *
 * Three terminal states:
 *   1. `state: "created"` — Booking didn't exist; we made it via
 *      createBookingFromHold (same path the webhook + client-verify
 *      take) with the recovered payment details.
 *   2. `state: "already-linked"` — Booking already exists. Idempotent
 *      no-op; we return its id so the admin can jump to it.
 *   3. `state: "no-hold"` — payment is captured in Razorpay but no
 *      SlotHold was found by `razorpayOrderId`. Either the hold was
 *      cleaned up (3am cron sweeps expired holds — by which time
 *      we'd lose the slot/date metadata we need), or this payment
 *      never went through our create-order route (e.g. test payment,
 *      old payment from before this code). Admin falls back to the
 *      manual "+ New Booking" flow.
 */
export async function recoverRazorpayPayment(
  paymentId: string,
): Promise<RecoverRazorpayResult> {
  await requireAdminBase("MANAGE_BOOKINGS");

  const trimmed = paymentId.trim();
  if (!trimmed.startsWith("pay_")) {
    return {
      success: false,
      error: "Payment ID must start with `pay_`",
    };
  }

  // 1. Check our DB first — if we already linked this payment to a
  //    Booking, return immediately. Saves a Razorpay round-trip when
  //    the admin pastes the same ID twice.
  const existing = await db.payment.findFirst({
    where: { razorpayPaymentId: trimmed },
    select: { bookingId: true },
  });
  if (existing) {
    return {
      success: true,
      state: "already-linked",
      bookingId: existing.bookingId,
    };
  }

  // 2. Fetch from Razorpay so we know the order id + amount.
  let rzpPayment: RazorpayPaymentRecord;
  try {
    rzpPayment = await fetchRazorpayPayment(trimmed);
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Couldn't fetch payment from Razorpay",
    };
  }

  const paymentMeta = {
    id: rzpPayment.id,
    orderId: rzpPayment.order_id,
    amountRupees: Math.round(rzpPayment.amount / 100),
    status: rzpPayment.status,
    captured: rzpPayment.captured,
    contact: rzpPayment.contact,
    email: rzpPayment.email,
    createdAt: rzpPayment.created_at,
  };

  // Only `captured` payments correspond to money actually settled to
  // our merchant account. Authorized-but-not-captured payments will
  // auto-void in 5 days and create no booking.
  if (!rzpPayment.captured) {
    return {
      success: false,
      error: `Payment is in state "${rzpPayment.status}" — not captured yet. Wait for capture or refund it.`,
      payment: paymentMeta,
    };
  }

  // 3. Look up our SlotHold via the Razorpay order id we stamped at
  //    create-order time. If it's gone, the admin needs the manual
  //    path (slot info isn't reconstructible from Razorpay alone).
  const hold = await db.slotHold.findFirst({
    where: { razorpayOrderId: rzpPayment.order_id },
  });
  if (!hold) {
    return {
      success: true,
      state: "no-hold",
      payment: paymentMeta,
    };
  }

  // 3b. Pass TOP-UP holds settle part of the booking with pass minutes,
  //     so the generic path below would read the captured remainder as
  //     an "advance" and bill the customer AGAIN for the hours the pass
  //     covered — and never debit the pass or write a redemption. Route
  //     them through the same helper the webhook and client verify use.
  if (hold.redeemPassId) {
    const holdWithConfig = await db.slotHold.findUnique({
      where: { id: hold.id },
      include: { courtConfig: true },
    });
    if (!holdWithConfig?.courtConfig) {
      return { success: false, error: "Hold is missing its court config" };
    }
    const topup = await completePassTopup({
      hold: holdWithConfig as typeof holdWithConfig & {
        courtConfig: NonNullable<typeof holdWithConfig.courtConfig>;
      },
      razorpayOrderId: rzpPayment.order_id,
      razorpayPaymentId: rzpPayment.id,
      razorpaySignature: `admin-recovery:${rzpPayment.id}`,
    });
    if (!topup.ok) {
      return { success: false, error: topup.error };
    }
    return {
      success: true,
      state: topup.alreadyDone ? "already-linked" : "created",
      bookingId: topup.bookingId,
      payment: paymentMeta,
    };
  }

  // 4. Recreate the booking. Mirror of the verify route's logic —
  //    derive isAdvance from amount-vs-fullAmount. Gear rides on the
  //    hold's equipmentTotalAmount, which createBookingFromHold folds
  //    into Booking.totalAmount — count it here too or the remainder
  //    is understated by exactly the gear.
  const appliedDiscount =
    hold.couponId && hold.discountAmount && hold.discountAmount > 0
      ? hold.discountAmount
      : 0;
  const pointsRedeemRupees =
    hold.pointsToRedeem && hold.pointsRedeemPaiseSaved
      ? Math.floor(hold.pointsRedeemPaiseSaved / 100)
      : 0;
  const fullAmount =
    hold.totalAmount -
    appliedDiscount -
    pointsRedeemRupees +
    (hold.equipmentTotalAmount ?? 0);
  const isAdvance = paymentMeta.amountRupees < fullAmount;
  const advanceAmount = isAdvance ? paymentMeta.amountRupees : undefined;
  const remainingAmount = isAdvance
    ? fullAmount - paymentMeta.amountRupees
    : undefined;

  let bookingId: string | null = null;
  try {
    bookingId = await _createBookingFromHold(
      hold.id,
      {
        method: "RAZORPAY",
        status: isAdvance ? "PARTIAL" : "COMPLETED",
        amount: paymentMeta.amountRupees,
        razorpayOrderId: rzpPayment.order_id,
        razorpayPaymentId: rzpPayment.id,
        // Manual-recovery signature — never null, distinguishable
        // from a client-verify signature for forensics. The Payment
        // row's anti-tamper purpose was already served when admin
        // confirmed this payment was real via the Razorpay API.
        razorpaySignature: `admin-recovery:${rzpPayment.id}`,
        confirmedAt: new Date(paymentMeta.createdAt * 1000),
        isPartialPayment: isAdvance,
        advanceAmount,
        remainingAmount,
      },
      "CONFIRMED",
    );
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Couldn't create booking from hold",
      payment: paymentMeta,
    };
  }

  if (!bookingId) {
    return {
      success: false,
      error:
        "Booking creation returned no id — hold may have been consumed mid-recovery",
      payment: paymentMeta,
    };
  }

  return {
    success: true,
    state: "created",
    bookingId,
    payment: paymentMeta,
  };
}

// ---------------------------------------------------------------------------
// extendBookingByThirtyMin — admin-only 30-minute extension
//
// Operational pattern: a customer asks to come in 30 min early, or
// "can we stay till 9:30?" — the admin clicks one button instead of
// going through the full slot-edit modal. Adds a single BookingSlot
// row of `durationMinutes: 30` adjacent to the booking's earliest
// (direction "before") or latest (direction "after") slot.
//
// Pricing: the admin passes the price they want to charge for the
// extra 30 min. The UI pre-fills with `suggestExtendPrice` (half
// the adjacent slot's price, or the same price when the adjacent
// slot is already a 30-min bowling slot) but they can override —
// 0 for a free/courtesy extension or any positive number.
//
// Conflict policy: hard-block. We refuse the extension if any other
// active booking with overlapping zones has a slot whose time window
// intersects the new 30-min window. The admin must resolve the
// double-book before they can extend.
//
// Operating hours: NOT enforced — admin extensions deliberately
// bypass closed-hour guards (mirrors the bowling admin-slot-picker
// override that already exists; matches venue reality where staff
// stay 30 min late to accommodate a regular).
// ---------------------------------------------------------------------------

type ExtendDirection = "before" | "after";

function slotStartMinutes(s: { startHour: number; startMinute: number }) {
  return s.startHour * 60 + s.startMinute;
}
function slotEndMinutes(s: {
  startHour: number;
  startMinute: number;
  durationMinutes: number;
}) {
  return slotStartMinutes(s) + s.durationMinutes;
}
function fmtMin(m: number) {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/**
 * Pre-fill default for the admin price input. Half the adjacent
 * existing slot's price for hourly slots; same price for bowling's
 * already-half-hour slots. Returns 0 when the booking has no slots
 * (defensive — shouldn't happen).
 */
export async function suggestExtendPrice(
  bookingId: string,
  direction: ExtendDirection,
): Promise<number> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      slots: {
        select: {
          startHour: true,
          startMinute: true,
          durationMinutes: true,
          price: true,
        },
      },
    },
  });
  if (!booking || booking.slots.length === 0) return 0;

  const adjacent =
    direction === "before"
      ? booking.slots.reduce((a, b) =>
          slotStartMinutes(a) < slotStartMinutes(b) ? a : b,
        )
      : booking.slots.reduce((a, b) =>
          slotEndMinutes(a) > slotEndMinutes(b) ? a : b,
        );

  // Bowling slots already represent 30 minutes; suggest the same
  // price. Hourly slots represent 60 min; suggest half.
  if (adjacent.durationMinutes === 30) return adjacent.price;
  return Math.round(adjacent.price / 2);
}

/**
 * Convert an existing money-paid booking to pass payment — the front
 * desk's "actually, use my pass" flow. Coverage is computed on the
 * booking's own slots with the same multi-pass engine as checkout;
 * every contributing pass is debited (one redemption row each). Full
 * coverage rewrites the payment to PASS/₹0; partial coverage keeps the
 * money method for the uncovered remainder. Money already collected is
 * NOT auto-refunded — the history note spells out what to settle.
 */
export async function convertBookingToPass(
  bookingId: string,
  note?: string,
): Promise<
  | {
      success: true;
      fullCoverage: boolean;
      remainderAmount: number;
      passes: { passName: string; coveredMinutes: number }[];
      collectedBefore: number;
    }
  | { success: false; error: string }
> {
  const admin = await requireAdminWithDetails();

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { payment: true, slots: true, courtConfig: true },
  });
  if (!booking) return { success: false, error: "Booking not found" };
  if (!booking.userId) {
    return { success: false, error: "Guest bookings can't use a pass" };
  }
  if (!booking.payment) {
    return { success: false, error: "No payment row on this booking" };
  }
  if (booking.status === "CANCELLED") {
    return { success: false, error: "Booking is cancelled" };
  }
  if (booking.payment.method === "PASS") {
    return { success: false, error: "This booking is already pass-paid" };
  }
  const existingLive = await db.passRedemption.findFirst({
    where: { bookingId, restoredAt: null },
    select: { id: true },
  });
  if (existingLive) {
    return { success: false, error: "This booking already redeems a pass" };
  }

  // Coverage on the booking's own slots — same engine as checkout.
  const slotDurationMinutes = booking.slots.some(
    (sl) => sl.durationMinutes === 30,
  )
    ? 30
    : 60;
  const offer = await getPassOfferForHold({
    userId: booking.userId,
    courtConfigId: booking.courtConfigId,
    date: booking.date,
    hours: booking.slots.map((sl) => sl.startHour),
    startMinutes: booking.slots.map((sl) => sl.startMinute),
    totalAmount: booking.slots.reduce((sum, sl) => sum + sl.price, 0),
    slotPrices: booking.slots.map((sl) => ({
      hour: sl.startHour,
      minute: sl.startMinute,
      price: sl.price,
    })),
    equipmentTotalAmount: booking.equipmentTotalAmount ?? 0,
    courtConfig: { slotDurationMinutes },
  }).catch(() => null);
  if (!offer) {
    return {
      success: false,
      error:
        "None of this customer's passes cover these slots (court, date or price band mismatch, or no balance)",
    };
  }

  // Debit every contributing pass; put everything back on any failure.
  let debitFailed = false;
  for (const share of offer.passes) {
    const ok = await debitPass(
      share.passId,
      share.coveredMinutes,
      bookingId,
      share.coveredAmount,
      share.coveredSlots,
    );
    if (!ok) {
      debitFailed = true;
      break;
    }
  }
  if (debitFailed) {
    await restorePassForBooking(bookingId).catch(() => {});
    return {
      success: false,
      error: "Pass balance changed while converting — nothing was moved; try again",
    };
  }

  const prior = booking.payment;
  const collectedBefore =
    prior.status === "COMPLETED" || prior.status === "PARTIAL"
      ? prior.amount
      : 0;
  const now = new Date();
  await db.$transaction(async (tx) => {
    if (offer.fullCoverage) {
      await tx.payment.update({
        where: { id: prior.id },
        data: {
          method: "PASS",
          status: "COMPLETED",
          amount: 0,
          isPartialPayment: false,
          advanceAmount: null,
          remainingAmount: null,
          confirmedBy: admin.id,
          confirmedAt: now,
        },
      });
    } else {
      // Remainder stays on the existing money method. If the customer
      // already paid at least the remainder, the row stays settled;
      // otherwise it goes back to PENDING for the counter.
      await tx.payment.update({
        where: { id: prior.id },
        data: {
          amount: offer.remainderAmount,
          status:
            collectedBefore >= offer.remainderAmount &&
            prior.status === "COMPLETED"
              ? "COMPLETED"
              : "PENDING",
          isPartialPayment: false,
          advanceAmount: null,
          remainingAmount: null,
        },
      });
    }
    const shareText = offer.passes
      .map(
        (sh) =>
          `${sh.passName} (${(sh.coveredMinutes / 60)
            .toFixed(1)
            .replace(/\.0$/, "")}h)`,
      )
      .join(" + ");
    const settleText =
      collectedBefore > 0
        ? offer.fullCoverage
          ? ` · ₹${collectedBefore} was already collected (${prior.method}) — settle the refund separately`
          : collectedBefore > offer.remainderAmount
            ? ` · ₹${collectedBefore} was already collected (${prior.method}) — ₹${collectedBefore - offer.remainderAmount} over the remainder, settle separately`
            : ""
        : "";
    await tx.bookingEditHistory.create({
      data: {
        bookingId,
        adminId: admin.id,
        adminUsername: admin.username,
        editType: "PAYMENT_EDITED",
        newAmount: offer.fullCoverage ? 0 : offer.remainderAmount,
        note:
          `Moved to pass payment — ${shareText}` +
          `; was ${prior.method}/${prior.status} ₹${prior.amount}` +
          settleText +
          (note?.trim() ? ` · ${note.trim()}` : ""),
      },
    });
  });

  const { revalidatePath } = await import("next/cache");
  revalidatePath(`/admin/bookings/${bookingId}`);
  return {
    success: true,
    fullCoverage: offer.fullCoverage,
    remainderAmount: offer.remainderAmount,
    passes: offer.passes.map((sh) => ({
      passName: sh.passName,
      coveredMinutes: sh.coveredMinutes,
    })),
    collectedBefore,
  };
}

/**
 * Coverage preview for the admin create-booking form: would this
 * customer's passes cover these slots? Mirrors adminCreateBooking's
 * offer computation (prices resolved from the day's classified rates).
 */
export async function previewAdminPassCoverage(args: {
  userId: string;
  courtConfigId: string;
  date: string;
  hours: number[];
  bowlingSlots?: Array<{ hour: number; minute: 0 | 30 }>;
}): Promise<
  | { eligible: false }
  | {
      eligible: true;
      fullCoverage: boolean;
      coveredMinutes: number;
      coveredAmount: number;
      remainderAmount: number;
      passes: { passName: string; coveredMinutes: number }[];
    }
> {
  await requireAdmin();
  const usingBowling = !!args.bowlingSlots?.length;
  if (!args.userId || (!usingBowling && args.hours.length === 0)) {
    return { eligible: false };
  }
  const offer = await getPassOfferForHold({
    userId: args.userId,
    courtConfigId: args.courtConfigId,
    date: new Date(args.date + "T00:00:00Z"),
    hours: usingBowling
      ? args.bowlingSlots!.map((sl) => sl.hour)
      : args.hours,
    startMinutes: usingBowling
      ? args.bowlingSlots!.map((sl) => sl.minute)
      : undefined,
    // Prices resolve from the day's classified rates inside the offer
    // computation; totalAmount is unused for coverage math.
    totalAmount: 0,
    courtConfig: { slotDurationMinutes: usingBowling ? 30 : 60 },
  }).catch(() => null);
  if (!offer) return { eligible: false };
  return {
    eligible: true,
    fullCoverage: offer.fullCoverage,
    coveredMinutes: offer.coveredMinutes,
    coveredAmount: offer.coveredAmount,
    remainderAmount: offer.remainderAmount,
    passes: offer.passes.map((sh) => ({
      passName: sh.passName,
      coveredMinutes: sh.coveredMinutes,
    })),
  };
}

export async function extendBookingByThirtyMin(
  bookingId: string,
  direction: ExtendDirection,
  priceOverride: number,
  // When set, the extra 30 min is paid by debiting this UserPass
  // instead of charging money (priceOverride is ignored → the slot is
  // recorded at ₹0). The pass must belong to the booking's customer,
  // match its court, be ACTIVE/unexpired, and have ≥30 min left.
  payWithPassId?: string,
): Promise<
  | {
      success: true;
      newSlot: {
        startHour: number;
        startMinute: number;
        durationMinutes: 30;
        price: number;
        label: string;
      };
    }
  | { success: false; error: string }
> {
  const admin = await requireAdminWithDetails();

  try {
    if (!payWithPassId && (!Number.isInteger(priceOverride) || priceOverride < 0)) {
      return {
        success: false,
        error: "Price must be a non-negative whole number",
      };
    }

    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      include: { slots: true, courtConfig: true, payment: true },
    });
    if (!booking) {
      return { success: false, error: "Booking not found" };
    }
    if (!["CONFIRMED", "PENDING"].includes(booking.status)) {
      return {
        success: false,
        error: `Cannot extend a ${booking.status.toLowerCase()} booking`,
      };
    }
    if (booking.slots.length === 0) {
      return {
        success: false,
        error: "Booking has no slots to extend from",
      };
    }

    // Live redemptions on this booking (one row per contributing pass)
    // decide whether the Payment row may flip PARTIAL below.
    const liveRedemptions = await db.passRedemption.findMany({
      where: { bookingId, restoredAt: null },
      select: { userPassId: true },
    });

    // Compute the new 30-min window in "minutes-since-midnight" terms.
    let newStartMin: number;
    if (direction === "before") {
      const earliest = booking.slots.reduce((a, b) =>
        slotStartMinutes(a) < slotStartMinutes(b) ? a : b,
      );
      newStartMin = slotStartMinutes(earliest) - 30;
      if (newStartMin < 0) {
        return {
          success: false,
          error: "Cannot extend before 00:00 (would roll past midnight)",
        };
      }
    } else {
      const latest = booking.slots.reduce((a, b) =>
        slotEndMinutes(a) > slotEndMinutes(b) ? a : b,
      );
      newStartMin = slotEndMinutes(latest);
      if (newStartMin + 30 > 24 * 60) {
        return {
          success: false,
          error: "Cannot extend past 24:00 (would roll into next day)",
        };
      }
    }
    const newEndMin = newStartMin + 30;
    const newStartHour = Math.floor(newStartMin / 60);
    const newStartMinute = newStartMin % 60; // 0 or 30
    const windowLabel = `${fmtMin(newStartMin)}–${fmtMin(newEndMin)}`;

    // Pass-paid extension: validate the pass covers 30 min for THIS
    // customer + court. On success the slot is recorded free (charge 0)
    // and 30 min is debited below inside the same transaction.
    let effectivePrice = priceOverride;
    // Value attribution for a pass-paid extension (rupees the 30 min are
    // worth at the pass's effective rate) — recorded on the redemption.
    let passExtendValue = 0;
    if (payWithPassId) {
      if (!booking.userId) {
        return { success: false, error: "Guest bookings can't use a pass" };
      }
      // Multi-pass bookings hold one redemption row per pass — an
      // extension may debit any eligible pass; a pass not yet on the
      // booking simply gets its own row below.
      const pass = await db.userPass.findUnique({
        where: { id: payWithPassId },
        include: {
          members: {
            where: { userId: booking.userId },
            select: { id: true },
          },
        },
      });
      // Validity is judged against the booking's play date — the pass
      // must have started by then and not expire before it (mirrors
      // getPassOfferForHold). The customer may be the pass owner OR a
      // shared member.
      const bookerCanUsePass =
        !!pass &&
        (pass.userId === booking.userId || pass.members.length > 0);
      const coversCourt =
        !!pass &&
        (await passCoversCourtGroup(pass.courtConfigId, booking.courtConfigId));
      // The extension's own hour must sit in the pass's price band —
      // an off-peak pass must not settle a peak half-hour.
      const coversBands =
        !!pass &&
        (await passBandsCoverHours(
          pass,
          booking.courtConfigId,
          booking.date,
          [Math.floor(newStartMin / 60) % 24],
        ));
      if (
        !pass ||
        !bookerCanUsePass ||
        !coversCourt ||
        !coversBands ||
        pass.status !== "ACTIVE" ||
        pass.startsAt.getTime() > booking.date.getTime() ||
        pass.expiresAt.getTime() <= booking.date.getTime() ||
        pass.remainingMinutes < 30
      ) {
        return {
          success: false,
          error:
            "Pass isn't valid for this booking (wrong court, outside its price band, not started/expired, or <30 min left)",
        };
      }
      passExtendValue = passMinutesValue(pass, 30);
      effectivePrice = 0;
    }

    // Conflict check — any active booking on the same date with
    // overlapping zones that has a slot intersecting the new window.
    const otherBookings = await db.booking.findMany({
      where: {
        date: booking.date,
        id: { not: bookingId },
        status: { in: [...OCCUPYING_BOOKING_STATUSES] },
      },
      include: { courtConfig: true, slots: true },
    });
    for (const other of otherBookings) {
      if (
        !zonesOverlap(other.courtConfig.zones, booking.courtConfig.zones)
      ) {
        continue;
      }
      for (const slot of other.slots) {
        const oStart = slotStartMinutes(slot);
        const oEnd = oStart + slot.durationMinutes;
        // Half-open intervals: overlap iff oStart < newEnd && newStart < oEnd
        if (oStart < newEndMin && newStartMin < oEnd) {
          return {
            success: false,
            error: `Conflicts with another booking on this court at ${fmtMin(
              oStart,
            )}–${fmtMin(oEnd)}`,
          };
        }
      }
    }

    // Apply the extension transactionally so a half-applied state
    // can't happen (slot added but total not updated, etc.).
    const previousTotal = booking.totalAmount;
    const newTotal = previousTotal + effectivePrice;
    const previousSlotsForLog = booking.slots
      .slice()
      .sort((a, b) => slotStartMinutes(a) - slotStartMinutes(b))
      .map((s) => s.startHour);
    const dirLabel = direction === "before" ? "before start" : "after end";

    await db.$transaction(async (tx) => {
      await tx.bookingSlot.create({
        data: {
          bookingId,
          startHour: newStartHour,
          startMinute: newStartMinute,
          durationMinutes: 30,
          price: effectivePrice,
        },
      });

      // Always bump totalAmount, even when the charge is 0 (no-op
      // arithmetically but keeps the code path uniform).
      await tx.booking.update({
        where: { id: bookingId },
        data: { totalAmount: newTotal },
      });

      // Pass-paid extension: debit 30 min atomically (gte guard) and
      // record a redemption keyed to this booking so cancel-restore
      // returns the time. A failed guard aborts the whole transaction.
      if (payWithPassId) {
        const debited = await tx.userPass.updateMany({
          where: {
            id: payWithPassId,
            remainingMinutes: { gte: 30 },
            status: "ACTIVE",
            expiresAt: { gt: new Date() },
          },
          data: { remainingMinutes: { decrement: 30 } },
        });
        if (debited.count === 0) {
          throw new Error("Pass balance changed — please retry");
        }
        // One redemption row per (booking, pass). An extension debited
        // from a pass already on the booking grows that pass's row;
        // otherwise it gets its own.
        const existingRed = await tx.passRedemption.findUnique({
          where: {
            bookingId_userPassId: { bookingId, userPassId: payWithPassId },
          },
        });
        // The extension's own half-hour joins the covered set, so a
        // later edit that removes it returns exactly these 30 minutes.
        const extSlot = {
          h: Math.floor(newStartMin / 60) % 24,
          m: newStartMin % 60,
          min: 30,
        };
        if (existingRed && !existingRed.restoredAt) {
          // A LEGACY row records only a minute count. Seeding `prior`
          // with [] would write a set containing just this extension —
          // the next edit would then price coverage at the extension's
          // ₹0 slot and demand the whole booking total at the venue,
          // and drop the rest of the minutes from the ledger.
          const prior =
            parseCoveredSlots(existingRed.coveredSlots) ??
            adoptLegacyCoverage(
              booking.slots.map((sl) => ({
                startHour: sl.startHour,
                startMinute: sl.startMinute,
                durationMinutes: sl.durationMinutes,
                price: sl.price,
              })),
              existingRed.minutes,
            );
          await tx.passRedemption.update({
            where: { id: existingRed.id },
            data: {
              minutes: { increment: 30 },
              value: { increment: passExtendValue },
              coveredSlots: [
                ...prior,
                extSlot,
              ] as unknown as Prisma.InputJsonValue,
            },
          });
        } else if (existingRed) {
          // Restored row still occupies the (booking, pass) slot — its
          // old minutes already went back to the pass, so reactivate it
          // with JUST this extension's figures (incrementing would
          // resurrect and lose the restored minutes).
          await tx.passRedemption.update({
            where: { id: existingRed.id },
            data: {
              userPassId: payWithPassId,
              minutes: 30,
              value: passExtendValue,
              coveredAmount: 0,
              coveredSlots: [extSlot] as unknown as Prisma.InputJsonValue,
              restoredAt: null,
            },
          });
        } else {
          await tx.passRedemption.create({
            data: {
              userPassId: payWithPassId,
              bookingId,
              minutes: 30,
              value: passExtendValue,
              // Extends record their slot at ₹0 (never joins the booking
              // total), so there's no list price to settle.
              coveredAmount: 0,
              coveredSlots: [extSlot] as unknown as Prisma.InputJsonValue,
            },
          });
        }
        await tx.userPass.updateMany({
          where: { id: payWithPassId, remainingMinutes: { lte: 0 }, status: "ACTIVE" },
          data: { status: "EXHAUSTED" },
        });
      }

      // Payment delta — only relevant when we actually charged extra.
      // If the booking was fully paid and we add a charge, mark it
      // partial with a remainder the admin can collect at the venue.
      // For already-partial bookings we just grow remainingAmount.
      // Pass-covered bookings (live redemption / ₹0 PASS / top-up) never
      // flip: their Payment.amount is money actually captured, and
      // flipping would demand the whole covered total at the venue — the
      // owed-at-venue invariant (total − payment − covered) already
      // surfaces the extension's charge, same as equipment owed.
      const isPassCoveredBooking =
        liveRedemptions.length > 0 ||
        booking.payment?.method === "PASS" ||
        booking.payment?.confirmedBy === "PASS_TOPUP";
      if (booking.payment && effectivePrice > 0 && !isPassCoveredBooking) {
        const currentPaid = booking.payment.amount;
        if (booking.payment.isPartialPayment) {
          await tx.payment.update({
            where: { id: booking.payment.id },
            data: {
              remainingAmount:
                (booking.payment.remainingAmount ?? 0) + priceOverride,
            },
          });
        } else if (currentPaid < newTotal) {
          // Was fully paid, now there's an extra charge — flip to
          // partial so the floor staff sees a remainder to collect.
          await tx.payment.update({
            where: { id: booking.payment.id },
            data: {
              isPartialPayment: true,
              advanceAmount: currentPaid,
              remainingAmount: newTotal - currentPaid,
            },
          });
        }
      }

      await tx.bookingEditHistory.create({
        data: {
          bookingId,
          adminId: admin.id,
          adminUsername: admin.username,
          editType: "SLOTS_CHANGED",
          previousSlots: previousSlotsForLog,
          newSlots: [...previousSlotsForLog, newStartHour],
          previousAmount: previousTotal,
          newAmount: newTotal,
          note: `Extended +30 min ${dirLabel} (${windowLabel})${
            payWithPassId
              ? " · paid by pass (−30 min)"
              : effectivePrice > 0
              ? ` · charged ₹${effectivePrice}`
              : " · free"
          }`,
        },
      });
    });

    await revalidateBookingPaths(bookingId);

    // Tell the customer — fire-and-forget, never blocks the operation.
    void notifyBookingActivity(bookingId, "EXTENDED");

    return {
      success: true,
      newSlot: {
        startHour: newStartHour,
        startMinute: newStartMinute,
        durationMinutes: 30,
        price: effectivePrice,
        label: windowLabel,
      },
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to extend booking",
    };
  }
}

// ---------------------------------------------------------------------------
// markBookingCompleted / markBookingAbsent — terminal admin closeouts
//
// Both move a CONFIRMED booking to a terminal state and settle the
// Payment row so it doesn't sit in PARTIAL forever. The advance the
// customer already paid is kept as earnings (no refund); the venue-
// side remainder, if any, is forfeit — not chased, not refunded.
//
// Difference:
//   - COMPLETED — customer attended; admin closes the slot out.
//   - ABSENT    — customer didn't show. Separate status so reports
//                 can split attendance from no-show.
//
// Both call into the same shared helper below to keep the Payment
// transitions identical.
// ---------------------------------------------------------------------------

type ClosingStatus = "COMPLETED" | "ABSENT";

async function closeOutBooking(
  bookingId: string,
  closingStatus: ClosingStatus,
): Promise<{ success: true } | { success: false; error: string }> {
  const admin = await requireAdminWithDetails();

  try {
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      include: { payment: true },
    });
    if (!booking) {
      return { success: false, error: "Booking not found" };
    }
    if (booking.status !== "CONFIRMED") {
      return {
        success: false,
        error: `Can only close out CONFIRMED bookings (current: ${booking.status})`,
      };
    }

    const previousStatus = booking.status;
    const previousPaymentStatus = booking.payment?.status ?? null;
    const previousAmount = booking.totalAmount;

    // Money the closeout leaves uncollected has to come off the booking
    // total: closed-out bookings count toward the revenue tiles (which sum
    // Booking.totalAmount), so leaving the full agreed figure books money
    // the venue never took.
    //
    // Two ways that happens:
    //
    //  (a) PARTIAL — advance in, remainder forfeit. remainingAmount (not
    //      total − amount) is the right source; it is already net of
    //      anything a pass settled, so a pass-covered booking doesn't get
    //      its covered hours written off as lost revenue. Gated on
    //      PARTIAL, not just isPartialPayment: adminEditPayment can leave
    //      a stale remainingAmount on a payment it marked COMPLETED, and
    //      writing that off would erase revenue the venue did collect.
    //
    //  (b) PENDING + ABSENT — the front desk's "book now, pay at the
    //      counter" flow (adminCreateBooking's CASH/UPI_QR branch, and
    //      confirmBookingManually) leaves Payment.status PENDING with
    //      amount = the AGREED price, not money received. Nobody who
    //      never showed up paid at the counter, so on a no-show the whole
    //      ticket is uncollected — and the tiles that DON'T gate on
    //      payment status (todayEarning here, the daily/monthly earnings
    //      charts in admin-analytics) would otherwise book every rupee of
    //      it. Deliberately ABSENT-only: a COMPLETED session was attended
    //      and staff routinely take the cash without pressing
    //      confirmCashPayment first, so writing that off would erase real
    //      takings. Pass-settled rupees are real money (recognised at
    //      pass purchase) and stay on the total.
    const redemptions = await db.passRedemption.findMany({
      where: { bookingId, restoredAt: null },
      select: { coveredAmount: true },
    });
    const passCovered = redemptions.reduce((s, r) => s + r.coveredAmount, 0);
    let forfeitedRemainder = 0;
    if (
      booking.payment?.isPartialPayment &&
      booking.payment.status === "PARTIAL"
    ) {
      forfeitedRemainder = Math.max(0, booking.payment.remainingAmount ?? 0);
    } else if (
      booking.payment?.status === "PENDING" &&
      closingStatus === "ABSENT"
    ) {
      forfeitedRemainder = booking.payment.isPartialPayment
        ? Math.max(0, booking.payment.remainingAmount ?? 0)
        : Math.max(0, booking.totalAmount - passCovered);
    }
    const retainedTotal = booking.totalAmount - forfeitedRemainder;
    // The write-off is NOT a discount. Folding it into discountAmount (as
    // this used to) let getAdminStats' average-per-day tile add it right
    // back — that tile grosses up by discountAmount on purpose, so coupon
    // spend doesn't drag the headline down. Instead take the same shape
    // adminEditPayment uses: total drops, discountAmount is untouched,
    // originalAmount re-derived off the invariant. The agreed price stays
    // legible in the BookingEditHistory row written below.
    const retainedOriginal =
      booking.discountAmount > 0 ? retainedTotal + booking.discountAmount : null;

    await db.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: closingStatus,
          ...(forfeitedRemainder > 0
            ? {
                totalAmount: retainedTotal,
                originalAmount: retainedOriginal,
              }
            : {}),
        },
      });

      // Settle the payment row so the closeout doesn't leave a
      // PARTIAL/PENDING/etc. in the books. The advance the customer
      // already paid stays as the Payment.amount — that's the earning
      // the admin captured. The unpaid remainder is wiped (forfeit).
      //
      // We touch Payment only if it exists and isn't already on a
      // terminal state. REFUNDED or FAILED payments wouldn't make
      // sense to mark COMPLETED from a closeout; we leave those alone.
      if (
        booking.payment &&
        booking.payment.status !== "COMPLETED" &&
        booking.payment.status !== "REFUNDED" &&
        booking.payment.status !== "FAILED"
      ) {
        await tx.payment.update({
          where: { id: booking.payment.id },
          data: {
            status: "COMPLETED",
            // Cash reporting keys on confirmedAt, so a closeout that
            // settles a payment without one hides that money from the
            // Sports Earnings KPI, "Today's Earning" and the CA report.
            // This is the bulk path — past dates get closed out in
            // batches — so it leaked the most.
            //
            // Dated to the SESSION, not to now. A payment still PENDING
            // at closeout was collected at the counter when the session
            // was played; stamping the moment an admin happens to press
            // the button would book last month's cash into this month.
            // An existing stamp (a partial's advance) is never touched.
            ...(booking.payment.confirmedAt
              ? {}
              : {
                  confirmedAt:
                    booking.date < new Date() ? booking.date : new Date(),
                }),
            // Advance becomes the final paid amount. For non-partial
            // bookings advanceAmount is null, so amount is already the
            // full paid value — leave it alone.
            ...(booking.payment.isPartialPayment
              ? {
                  remainingAmount: 0,
                  isPartialPayment: false,
                }
              : {}),
          },
        });
      }

      await tx.bookingEditHistory.create({
        data: {
          bookingId,
          adminId: admin.id,
          adminUsername: admin.username,
          editType:
            closingStatus === "COMPLETED"
              ? "MARKED_COMPLETED"
              : "MARKED_ABSENT",
          previousAmount,
          newAmount: retainedTotal,
          note:
            (closingStatus === "COMPLETED"
              ? `Booking closed out as COMPLETED (was ${previousStatus}, payment was ${previousPaymentStatus ?? "—"}). Advance retained as earnings.`
              : `Booking closed out as ABSENT — customer no-show (was ${previousStatus}, payment was ${previousPaymentStatus ?? "—"}). Advance retained as earnings.`) +
            (forfeitedRemainder > 0
              ? ` Uncollected remainder Rs.${forfeitedRemainder} written off — total ${previousAmount} → ${retainedTotal}.`
              : ""),
        },
      });
    });

    await revalidateBookingPaths(bookingId);

    // Tell the customer — fire-and-forget, never blocks the operation.
    void notifyBookingActivity(
      bookingId,
      closingStatus === "ABSENT" ? "MARKED_ABSENT" : "COMPLETED",
    );

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : `Failed to close out booking as ${closingStatus}`,
    };
  }
}

export async function markBookingCompleted(bookingId: string) {
  return closeOutBooking(bookingId, "COMPLETED");
}

export async function markBookingAbsent(bookingId: string) {
  return closeOutBooking(bookingId, "ABSENT");
}

// ---------------------------------------------------------------------------
// recoverDqrPayment
// ---------------------------------------------------------------------------

export type RecoverDqrResult =
  | { success: true; state: "created" | "already-linked"; kind: "booking" | "cafe" | "pass"; id: string }
  | { success: true; state: "pending"; message: string }
  | { success: false; error: string };

/**
 * Complete a PhonePe DQR payment from its transaction id.
 *
 * The Razorpay equivalent has existed for a while; DQR had nothing, so
 * an admin holding a PhonePe txn id for a customer whose money left
 * their account had no route except editing the database by hand. That
 * mattered most in exactly the case it was missing: the 2026-07-11
 * intent incident, where PhonePe leaves a paid transaction PENDING and
 * neither the callback nor the client poll ever confirms it.
 *
 * Probes PhonePe, then routes to whichever confirm path owns the id —
 * booking, cafe order or pass purchase — all of which are idempotent,
 * so re-running is safe.
 *
 * A PENDING result is reported honestly rather than forced: if PhonePe
 * still doesn't acknowledge the payment, creating a booking here would
 * be inventing money we can't see. Reconcile in the PhonePe dashboard
 * first, then use the ordinary "+ New Booking" flow.
 */
export async function recoverDqrPayment(
  transactionId: string,
): Promise<RecoverDqrResult> {
  await requireAdmin();

  const txn = transactionId.trim();
  if (!txn) return { success: false, error: "Enter a PhonePe transaction id" };

  let state: string;
  let providerReferenceId: string | undefined;
  let capturedPaise: number | undefined;
  try {
    const status = await qrStatus(txn);
    state = status.state;
    providerReferenceId = status.providerReferenceId;
    capturedPaise = status.amount;
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? `Couldn't reach PhonePe: ${err.message}`
          : "Couldn't reach PhonePe",
    };
  }

  if (state !== "COMPLETED") {
    return {
      success: true,
      state: "pending",
      message:
        `PhonePe reports this transaction as ${state}. If the customer's account was debited, this is the known intent-replication gap — reconcile it in the PhonePe Business dashboard, then create the booking manually.`,
    };
  }

  // The txn-id prefix tells us which surface minted it (DQR_ booking,
  // DQRC_ cafe, DQRP_ pass); fall back to trying each.
  const { revalidatePath } = await import("next/cache");
  const booking = await confirmDqrBooking(txn, providerReferenceId);
  if (booking.bookingId) {
    revalidatePath("/admin/bookings");
    return {
      success: true,
      state: booking.alreadyDone ? "already-linked" : "created",
      kind: "booking",
      id: booking.bookingId,
    };
  }
  const cafe = await confirmDqrCafe(txn, providerReferenceId);
  if (cafe.orderId) {
    revalidatePath("/admin/cafe");
    return {
      success: true,
      state: cafe.alreadyDone ? "already-linked" : "created",
      kind: "cafe",
      id: cafe.orderId,
    };
  }
  // The captured amount MUST be forwarded: without it confirmDqrPass
  // can't price-check, and instead of declining harmlessly it burns the
  // intent with the terminal AMOUNT_MISMATCH sentinel — after which no
  // later S2S callback or status poll can ever issue the pass.
  const pass = await confirmDqrPass(txn, providerReferenceId, capturedPaise);
  if (pass.userPassId) {
    revalidatePath("/admin/passes");
    return {
      success: true,
      state: pass.alreadyDone ? "already-linked" : "created",
      kind: "pass",
      id: pass.userPassId,
    };
  }
  if (pass.mismatch) {
    // The intent WAS found — saying "nothing points at it" would send the
    // admin hunting for a record that exists.
    return {
      success: false,
      error:
        "PhonePe confirms this payment and we found its pass purchase, but the captured amount doesn't match the plan's price — the plan was repriced while the customer paid. It's on the orphan-payments worklist: issue the pass manually or refund from the PhonePe dashboard.",
    };
  }

  return {
    success: false,
    error:
      "PhonePe confirms this payment, but nothing in our records points at it — the hold or purchase intent is gone (or its transaction id was overwritten). Reconcile in the PhonePe dashboard and create the booking manually.",
  };
}
