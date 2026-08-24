/**
 * Mobile mirror of the venue-balance arithmetic in `lib/payment-split.ts`.
 *
 * Lives in its own RN-free module (no `react-native` import) purely so the
 * parity suite at `tests/payment-split.parity.test.ts` can import it under
 * plain Node and prove it still agrees with the server copy. It used to sit
 * inside `admin-bookings.ts`, which imports `react-native` and therefore could
 * not be loaded by a test runner — so the "keep these in sync" rule was a
 * convention with nothing enforcing it. Now a drift fails CI.
 *
 * `admin-bookings.ts` re-exports this, so every existing import site is
 * unchanged.
 */

/**
 * How much is STILL owed at the venue on a partial-payment booking.
 * Mirrors venueAmountStillDue in lib/payment-split.ts — a remainder can
 * be collected in instalments, so the legs already taken must be netted
 * off or every surface keeps offering the full amount.
 *
 * Discount legs are NOT subtracted: applying one already reduced
 * Booking.totalAmount, so it is inside `totalAmount`.
 *
 * NOTE — the `isPartialPayment` short-circuit below is NOT present in the
 * server copy. It is provably redundant rather than a real difference: every
 * writer that sets `remainingAmount > 0` also sets `isPartialPayment: true`
 * (dqr/claim-paid, adminCreateBooking, the extend/edit paths), and
 * `recomputePartialPaymentAmounts` nulls `remainingAmount` whenever a payment
 * stops being partial. Under that invariant both copies return the same number
 * for every reachable row, which is what the parity suite pins. Deliberately
 * left in place rather than "tidied" to match the server — it costs nothing and
 * this is a money path.
 */
export function venueAmountStillDue(
  totalAmount: number,
  payment: {
    isPartialPayment?: boolean;
    advanceAmount?: number | null;
    remainingAmount?: number | null;
    remainderCashAmount?: number | null;
    remainderUpiAmount?: number | null;
  } | null,
): number {
  if (!payment?.isPartialPayment) return 0;
  if ((payment.remainingAmount ?? 0) <= 0) return 0;
  const collected =
    (payment.remainderCashAmount ?? 0) + (payment.remainderUpiAmount ?? 0);
  return Math.max(totalAmount - (payment.advanceAmount ?? 0) - collected, 0);
}
