/**
 * Shared payment-bifurcation helpers.
 *
 * Used by both the full sales-revenue workbook (lib/admin-export.ts)
 * and the trimmed CA report (lib/reports/workers/ca.ts) so the two
 * exports always agree on what counts as cash / UPI QR / online /
 * discount-at-venue.
 */

export type BookingPaymentForSplit = {
  method: string;
  amount: number;
  isPartialPayment: boolean;
  advanceAmount: number | null;
  remainingAmount: number | null;
  remainderMethod: string | null;
  remainderCashAmount: number | null;
  remainderUpiAmount: number | null;
  remainderDiscountAmount: number | null;
};

/**
 * Bifurcate a booking's Payment row into Cash / UPI QR / Online
 * (Razorpay + PhonePe) / Discount-at-venue components.
 *
 * For partial-payment bookings, the advance is paid via
 * `payment.method` (one of CASH / UPI_QR / RAZORPAY / PHONEPE) and
 * the venue-side remainder is split across `remainderCashAmount`,
 * `remainderUpiAmount`, `remainderDiscountAmount`. We add the two
 * legs together. For non-partial bookings, the whole `amount` lands
 * in the column matching `method`.
 *
 * Legacy rows that predate the split-collection feature have only
 * `remainderMethod` populated (no per-method amounts) — we fall
 * back to that and bucket the whole `remainingAmount`.
 *
 * cash + upiQr + online === payment.amount in every case.
 * venueDiscount is shown separately because it's NOT money in —
 * it's money the venue wrote off at collection time.
 */
export function splitBookingPayment(
  p: BookingPaymentForSplit | null | undefined,
) {
  if (!p) return { cash: 0, upiQr: 0, online: 0, venueDiscount: 0 };

  const advance = p.isPartialPayment ? (p.advanceAmount ?? 0) : p.amount;
  const cashAdv = p.method === "CASH" ? advance : 0;
  const upiAdv = p.method === "UPI_QR" ? advance : 0;
  const onlineAdv =
    p.method === "RAZORPAY" || p.method === "PHONEPE" ? advance : 0;

  const remCash =
    p.remainderCashAmount ??
    (p.remainderMethod === "CASH" ? (p.remainingAmount ?? 0) : 0);
  const remUpi =
    p.remainderUpiAmount ??
    (p.remainderMethod === "UPI_QR" ? (p.remainingAmount ?? 0) : 0);
  const remDiscount = p.remainderDiscountAmount ?? 0;

  return {
    cash: cashAdv + remCash,
    upiQr: upiAdv + remUpi,
    online: onlineAdv,
    venueDiscount: remDiscount,
  };
}

/**
 * Cafe payments are simpler — no partial-payment flow, so each
 * order's amount lives entirely in one bucket (Cash / UPI QR /
 * Online).
 */
export type CafePaymentForSplit =
  | { method: string; amount: number }
  | null
  | undefined;

export function splitCafePayment(p: CafePaymentForSplit) {
  if (!p) return { cash: 0, upiQr: 0, online: 0 };
  return {
    cash: p.method === "CASH" ? p.amount : 0,
    upiQr: p.method === "UPI_QR" ? p.amount : 0,
    online:
      p.method === "RAZORPAY" || p.method === "PHONEPE" ? p.amount : 0,
  };
}

/**
 * How much is STILL owed at the venue on a partial-payment booking.
 *
 * Derived from totalAmount - advance rather than trusting
 * Payment.remainingAmount, which on historical rows stored the
 * pre-discount figure and reads ₹100 high on coupon bookings. The
 * venue legs already collected are then netted off, because a
 * remainder can be settled in instalments — without that, every
 * surface keeps offering the FULL amount after a part payment.
 *
 * Discount legs are deliberately NOT subtracted: applying a discount
 * already reduces Booking.totalAmount, so it is inside `totalAmount`.
 */
/** Money physically taken at the venue against the remainder. */
export function venueCollected(payment: {
  remainderCashAmount?: number | null;
  remainderUpiAmount?: number | null;
}): number {
  return (
    (payment.remainderCashAmount ?? 0) + (payment.remainderUpiAmount ?? 0)
  );
}

/**
 * Recompute Payment.amount + Payment.remainingAmount after an admin
 * edits the payment by hand.
 *
 * Extracted and pure because the arithmetic here is the whole bug it
 * was written to fix. The old inline version derived both figures from
 * (total, advance, status) alone, which quietly asserts that the only
 * money in is the advance. That is false the moment the venue collects
 * a remainder: flipping a settled booking's status — COMPLETED →
 * PENDING → PARTIAL, exactly what an admin does when correcting a
 * mistake — recomputed `amount` back down to the advance and
 * `remainingAmount` back up to the full balance. The counter's ₹2,000
 * vanished from Payment.amount (which is what revenue sums read) and
 * the booking started asking to be collected all over again.
 *
 * Money already in the till is not a function of the status field.
 * `alreadyCollected` is threaded through both figures so a status
 * correction stays a status correction.
 */
export function recomputePartialPaymentAmounts(input: {
  total: number;
  advance: number | null;
  status: string;
  isPartial: boolean;
  /** venueCollected(prior) — cash + UPI taken against the remainder. */
  alreadyCollected: number;
}): { amount: number; remainingAmount: number | null } {
  const { total, advance, status, isPartial, alreadyCollected } = input;

  if (!isPartial) return { amount: total, remainingAmount: null };

  // Marking it COMPLETED by hand means "everything is in", whatever the
  // legs say — the admin is asserting the final state.
  if (status === "COMPLETED") return { amount: total, remainingAmount: 0 };

  const adv = advance ?? 0;
  return {
    amount: adv + alreadyCollected,
    // Discount legs aren't subtracted: taking one already reduced
    // Booking.totalAmount, so it is inside `total`.
    remainingAmount: Math.max(0, total - adv - alreadyCollected),
  };
}

export function venueAmountStillDue(
  totalAmount: number,
  // Optional-tolerant: some callers project a narrower Payment shape.
  // A missing leg reads as 0, which is the pre-instalment behaviour.
  payment: {
    advanceAmount?: number | null;
    remainingAmount?: number | null;
    remainderCashAmount?: number | null;
    remainderUpiAmount?: number | null;
  },
): number {
  // remainingAmount is the authoritative "settled?" flag — it hits 0
  // only when the collection completed.
  if ((payment.remainingAmount ?? 0) <= 0) return 0;
  const collected =
    (payment.remainderCashAmount ?? 0) + (payment.remainderUpiAmount ?? 0);
  return Math.max(totalAmount - (payment.advanceAmount ?? 0) - collected, 0);
}
