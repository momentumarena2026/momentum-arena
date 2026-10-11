/**
 * Where a DQR payment comes to rest.
 *
 * Written from a real production defect, 2026-10-11. Two pickleball
 * bookings on the same day, both ₹350 of ₹700 paid by UPI_QR, both
 * carrying isPartialPayment: true, advanceAmount: 350 and
 * remainingAmount: 350. One row said PARTIAL. The other said COMPLETED.
 *
 * The only difference between those two customers was that one of them
 * tapped "I've paid" while waiting for PhonePe. That routed their
 * payment through confirmDqrBooking's late-settlement branch, which
 * stamped COMPLETED without ever reading isPartialPayment — so a
 * half-paid booking recorded itself as settled while still saying ₹350
 * was owed two columns to the left.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { settledPaymentStatus, isAlreadySettled } from "../lib/dqr-settlement";

test("a 50% advance settles at PARTIAL, not COMPLETED", () => {
  // The exact shape of the booking that was wrong in production.
  assert.equal(
    settledPaymentStatus({ isPartialPayment: true, remainingAmount: 350 }),
    "PARTIAL",
  );
});

test("a payment in full settles at COMPLETED", () => {
  assert.equal(
    settledPaymentStatus({ isPartialPayment: false, remainingAmount: null }),
    "COMPLETED",
  );
});

test("a partial whose remainder has already been collected is COMPLETED", () => {
  // Not hypothetical: the counter can take the remaining cash before
  // the gateway's callback lands. Keying on isPartialPayment alone
  // would hold that booking open at PARTIAL forever with ₹0 owed.
  assert.equal(
    settledPaymentStatus({ isPartialPayment: true, remainingAmount: 0 }),
    "COMPLETED",
  );
});

test("a full payment carrying a stale remainder is not held open", () => {
  // The mirror of the case above, and why isPartialPayment is checked
  // as well as the figure.
  assert.equal(
    settledPaymentStatus({ isPartialPayment: false, remainingAmount: 350 }),
    "COMPLETED",
  );
});

test("a null remainder on a partial reads as nothing owed", () => {
  // Defensive: null means the column was never populated, which is the
  // pre-advance shape. Treating it as "owed" would convert every
  // historic full payment into a PARTIAL.
  assert.equal(
    settledPaymentStatus({ isPartialPayment: true, remainingAmount: null }),
    "COMPLETED",
  );
});

// ── Idempotency ────────────────────────────────────────────────────────

test("settled is decided by confirmedAt, not by status", () => {
  // The guard this replaced was `status === "COMPLETED"`. That was a
  // correct test only while COMPLETED was the only resting state. The
  // moment a settled payment can legitimately rest at PARTIAL, the old
  // guard stops recognising finished work — and since the DQR status
  // poll AND the S2S callback both fire for every transaction, the
  // second one through would re-enter the settlement branch and
  // re-send the customer's confirmation SMS and push.
  assert.equal(isAlreadySettled({ confirmedAt: new Date() }), true);
  assert.equal(isAlreadySettled({ confirmedAt: null }), false);
});

test("an unsettled 'I've paid' claim is not mistaken for a settled payment", () => {
  // claim-paid deliberately leaves confirmedAt null so the gateway's
  // later report is still allowed to do its work.
  assert.equal(isAlreadySettled({ confirmedAt: null }), false);
});

// ── The property that matters ──────────────────────────────────────────

test("status and isPartialPayment can never contradict each other again", () => {
  // The production row's combination — isPartialPayment true, money
  // still owed, status COMPLETED — must be unreachable through this
  // function, whichever branch calls it.
  for (const remainingAmount of [1, 350, 700, 10_000]) {
    assert.equal(
      settledPaymentStatus({ isPartialPayment: true, remainingAmount }),
      "PARTIAL",
      `₹${remainingAmount} owed must never read as COMPLETED`,
    );
  }
});
