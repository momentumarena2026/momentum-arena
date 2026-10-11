/**
 * What status a DQR payment comes to rest at once the gateway settles.
 *
 * Pure, and split out of lib/dqr-confirm.ts so it can be tested without
 * a database — the same reason lib/daily-push-rules.ts and
 * lib/challenge-rules.ts exist apart from their engines.
 *
 * ── THE BUG THIS EXISTS TO PREVENT ────────────────────────────────────
 * There are two ways a DQR booking reaches "paid", and only one of them
 * used to get this right.
 *
 *   FRESH        PhonePe reports before anybody clicks anything.
 *                confirmDqrBooking creates the Payment itself and
 *                derives both fields from one variable:
 *                  status: isAdvance ? "PARTIAL" : "COMPLETED"
 *                  isPartialPayment: isAdvance
 *                These cannot disagree.
 *
 *   LATE         The customer taps "I've paid" first. claim-paid
 *                creates a PENDING Payment carrying isPartialPayment,
 *                advanceAmount and remainingAmount. PhonePe settles
 *                afterwards and confirmDqrBooking UPDATES that row.
 *
 * The late branch stamped `status: "COMPLETED"` unconditionally. It
 * never read isPartialPayment, so a half-paid booking was recorded as
 * fully paid while advanceAmount and remainingAmount still said ₹350
 * was owed. Found in production on 2026-10-11: two pickleball bookings
 * an hour apart, both ₹350 of ₹700 on UPI_QR, one PARTIAL and one
 * COMPLETED, and the only difference between the customers was that one
 * of them pressed a button.
 *
 * It cost nothing that day, because the counter's "Collect ₹350 at
 * venue" chip and markRemainderCollected both gate on isPartialPayment
 * rather than on status, as does the cash-basis split in
 * lib/payment-split.ts. What it did corrupt is every list and count
 * that filters `payment.status = 'COMPLETED'` — the booking reads as
 * settled in the admin lists and in the stats.
 * ──────────────────────────────────────────────────────────────────────
 */

export interface SettlingPayment {
  isPartialPayment: boolean;
  remainingAmount: number | null;
}

/**
 * COMPLETED only when nothing is still owed.
 *
 * Both conditions are required, and neither is redundant:
 *
 *   isPartialPayment   the customer chose the advance option. Without
 *                      it, a full payment that happens to carry a
 *                      stale remainingAmount would be held open.
 *   remainingAmount    what is actually left. Without it, a partial
 *                      whose remainder was collected at the counter
 *                      before the gateway settled would be stuck at
 *                      PARTIAL forever with ₹0 outstanding.
 */
export function settledPaymentStatus(p: SettlingPayment): "PARTIAL" | "COMPLETED" {
  return p.isPartialPayment && (p.remainingAmount ?? 0) > 0 ? "PARTIAL" : "COMPLETED";
}

/**
 * Has this payment already been settled by an earlier callback or poll?
 *
 * `confirmedAt`, not `status`. The old check was `status === "COMPLETED"`,
 * which was a correct test only while COMPLETED was the sole resting
 * state. The moment a settled payment can legitimately come to rest at
 * PARTIAL, that test starts returning false for a payment that is
 * finished — and since the DQR status poll and the S2S callback both
 * fire for every transaction, the second one through would re-enter the
 * settlement branch and re-send the confirmation SMS and push.
 *
 * The claim path (`/api/phonepe/dqr/claim-paid`) deliberately leaves
 * confirmedAt null, so an unsettled claim is never mistaken for a
 * settled payment.
 */
export function isAlreadySettled(p: { confirmedAt: Date | null }): boolean {
  return p.confirmedAt !== null;
}
