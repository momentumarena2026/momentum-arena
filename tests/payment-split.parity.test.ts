/**
 * Parity + behaviour suite for the venue-balance arithmetic.
 *
 * `docs/PROJECT-CONTEXT.md` §8 says lib/payment-split.ts is "Mirrored in
 * apps/mobile/src/lib/admin-bookings.ts" and that the pair must stay in sync.
 * Until now nothing enforced that: the two copies were written separately in
 * 071b3ac and have been silently non-identical ever since (the mobile copy
 * carries an extra `isPartialPayment` short-circuit).
 *
 * This suite pins the equivalence over the domain the database can actually
 * produce, so a future edit to one copy and not the other fails CI.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { venueAmountStillDue as server } from "../lib/payment-split";
import { venueAmountStillDue as mobile } from "../apps/mobile/src/lib/payment-split";

/**
 * The reachable domain. Every writer that sets remainingAmount > 0 also sets
 * isPartialPayment: true (app/api/phonepe/dqr/claim-paid, adminCreateBooking,
 * the extend/edit-payment paths), and recomputePartialPaymentAmounts nulls
 * remainingAmount the moment a payment stops being partial. So a row with
 * remainingAmount > 0 always carries isPartialPayment = true.
 */
const amounts = [0, 1, 100, 999, 2000, 250_000];
const legs = [null, 0, 1, 100, 2000];

function* reachableRows() {
  for (const total of amounts)
    for (const advance of legs)
      for (const cash of legs)
        for (const upi of legs)
          for (const remaining of [null, 0, 1, 500, 2000]) {
            // Invariant: remainingAmount > 0 implies isPartialPayment.
            const isPartialPayment = (remaining ?? 0) > 0;
            yield {
              total,
              payment: {
                isPartialPayment,
                advanceAmount: advance,
                remainingAmount: remaining,
                remainderCashAmount: cash,
                remainderUpiAmount: upi,
              },
            };
          }
}

test("server and mobile agree on every row the DB can produce", () => {
  let checked = 0;
  for (const { total, payment } of reachableRows()) {
    assert.equal(
      mobile(total, payment),
      server(total, payment),
      `divergence at total=${total} ${JSON.stringify(payment)}`,
    );
    checked++;
  }
  assert.ok(checked > 3000, `expected a broad sweep, only checked ${checked}`);
});

test("the known non-identical branch is unreachable, not harmless", () => {
  // isPartialPayment=false with remainingAmount>0 is the ONE input where the
  // two copies disagree. If a future migration or hand-edit ever makes this
  // state reachable, this test documents exactly what breaks.
  const rogue = {
    isPartialPayment: false,
    advanceAmount: 500,
    remainingAmount: 1500,
    remainderCashAmount: null,
    remainderUpiAmount: null,
  };
  assert.equal(mobile(2000, rogue), 0, "mobile short-circuits on the flag");
  assert.equal(server(2000, rogue), 1500, "server trusts remainingAmount");
  assert.notEqual(
    mobile(2000, rogue),
    server(2000, rogue),
    "if this ever becomes equal the copies were unified — update this test",
  );
});

test("a remainder collected in instalments is netted off, not re-offered", () => {
  // The bug 071b3ac was written to fix: without netting, every surface keeps
  // asking for the full balance after a part payment.
  const p = {
    isPartialPayment: true,
    advanceAmount: 500,
    remainingAmount: 1500,
    remainderCashAmount: 1000,
    remainderUpiAmount: null,
  };
  assert.equal(server(2000, p), 500);
  assert.equal(mobile(2000, p), 500);
});

test("settled bookings owe nothing", () => {
  const settled = {
    isPartialPayment: true,
    advanceAmount: 500,
    remainingAmount: 0,
    remainderCashAmount: 1500,
    remainderUpiAmount: null,
  };
  assert.equal(server(2000, settled), 0);
  assert.equal(mobile(2000, settled), 0);
});

test("over-collection never goes negative", () => {
  const over = {
    isPartialPayment: true,
    advanceAmount: 500,
    remainingAmount: 1500,
    remainderCashAmount: 5000,
    remainderUpiAmount: null,
  };
  assert.equal(server(2000, over), 0);
  assert.equal(mobile(2000, over), 0);
});

test("discount legs are not subtracted twice", () => {
  // A discount already reduced Booking.totalAmount, so passing the
  // post-discount total is the whole contract. 1900 total, 500 advance.
  const p = {
    isPartialPayment: true,
    advanceAmount: 500,
    remainingAmount: 1400,
    remainderCashAmount: null,
    remainderUpiAmount: null,
  };
  assert.equal(server(1900, p), 1400);
  assert.equal(mobile(1900, p), 1400);
});
