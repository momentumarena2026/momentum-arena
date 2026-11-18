/**
 * Behaviour suite for re-attributing a corrected venue collection
 * across the instalments it arrived in (lib/booking-settlement.ts).
 *
 * The thing worth pinning is an invariant, not an output shape. The
 * settlement rows only earn their keep if they keep summing to the
 * Payment.remainder* columns, because the collections report reads the
 * ROWS while the P&L, the CA report and the booking detail all still
 * read the COLUMNS. One rupee of drift between them and two screens
 * disagree about the same booking with no way to tell which is right.
 *
 * So: every case here checks that the legs sum to exactly the target,
 * that nothing goes negative, and that a correction never invents a
 * date — the rows come back in the same order, and a one-instalment
 * booking (the case that actually happens) gets its single row edited
 * in place rather than replaced.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  reallocateSettlements,
  settlementAmount,
  settlementMethod,
  type SettlementLegs,
} from "../lib/booking-settlement";

function legs(
  cashAmount: number,
  upiAmount: number,
  discountAmount = 0,
): SettlementLegs {
  return { cashAmount, upiAmount, discountAmount };
}

function sum(rows: SettlementLegs[], leg: keyof SettlementLegs): number {
  return rows.reduce((n, r) => n + r[leg], 0);
}

function assertSumsTo(rows: SettlementLegs[], target: SettlementLegs) {
  assert.equal(sum(rows, "cashAmount"), target.cashAmount, "cash");
  assert.equal(sum(rows, "upiAmount"), target.upiAmount, "upi");
  assert.equal(sum(rows, "discountAmount"), target.discountAmount, "discount");
  for (const r of rows) {
    assert.ok(r.cashAmount >= 0, "cash went negative");
    assert.ok(r.upiAmount >= 0, "upi went negative");
    assert.ok(r.discountAmount >= 0, "discount went negative");
  }
}

test("one instalment: the single row is simply rewritten", () => {
  // The overwhelmingly common correction — "that was UPI, not cash" on
  // a balance taken in one go.
  const out = reallocateSettlements([legs(800, 0)], legs(0, 800));
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], legs(0, 800));
});

test("no rows to spread across returns nothing to write", () => {
  // Pre-ledger bookings have no rows; the caller creates one instead,
  // dated from the collection record rather than from today.
  assert.deepEqual(reallocateSettlements([], legs(500, 0)), []);
});

test("two instalments keep both rows, each with the share it closed", () => {
  const out = reallocateSettlements([legs(300, 0), legs(900, 0)], legs(1200, 0));
  assert.equal(out.length, 2);
  assertSumsTo(out, legs(1200, 0));
  assert.equal(out[0].cashAmount, 300);
  assert.equal(out[1].cashAmount, 900);
});

test("the newest row absorbs the rounding, and the legs still sum exactly", () => {
  // 1000 split three ways over rows holding 1:1:1 cannot divide evenly.
  const out = reallocateSettlements(
    [legs(100, 0), legs(100, 0), legs(100, 0)],
    legs(1000, 0),
  );
  assertSumsTo(out, legs(1000, 0));
  assert.deepEqual(
    out.map((r) => r.cashAmount),
    [333, 333, 334],
  );
});

test("a correction moves money between columns, never between dates", () => {
  // The case that made the first version of this wrong. Two visits of
  // Rs.500 cash each, corrected to Rs.700 cash + Rs.300 UPI: each date
  // must still hold Rs.500, now mixed. Proportioning by the UPI leg
  // instead would find no prior UPI and dump all Rs.300 on the later
  // visit, inventing money on a day it did not arrive.
  const out = reallocateSettlements([legs(500, 0), legs(500, 0)], legs(700, 300));
  assertSumsTo(out, legs(700, 300));
  assert.deepEqual(out[0], legs(350, 150));
  assert.deepEqual(out[1], legs(350, 150));
  for (const r of out) {
    assert.equal(r.cashAmount + r.upiAmount + r.discountAmount, 500);
  }
});

test("a whole balance switching column stays on its own dates", () => {
  // Rs.300 then Rs.900, both cash, corrected to all UPI.
  const out = reallocateSettlements([legs(300, 0), legs(900, 0)], legs(0, 1200));
  assertSumsTo(out, legs(0, 1200));
  assert.deepEqual(
    out.map((r) => r.upiAmount),
    [300, 900],
  );
});

test("a row's share is its whole contribution, not its cash", () => {
  // Visit 1 took Rs.100 cash + Rs.300 UPI, visit 2 took Rs.600 cash:
  // Rs.400 and Rs.600 of the balance. Corrected to all cash, those two
  // dates must read Rs.400 and Rs.600. Weighting by the cash column
  // instead (100 : 600) would read Rs.142 and Rs.858 — Rs.258 of real
  // money shifted onto the later date. Every other case here has
  // cash-only priors, where the two rules happen to agree, so this is
  // the one that tells them apart.
  const out = reallocateSettlements([legs(100, 300), legs(600, 0)], legs(1000, 0));
  assertSumsTo(out, legs(1000, 0));
  assert.deepEqual(
    out.map((r) => r.cashAmount),
    [400, 600],
  );
});

test("rows holding nothing hand the whole target to the newest", () => {
  // Reachable only after a correction emptied them, so there are no
  // shares to go by. The alternative is dividing by zero.
  const out = reallocateSettlements([legs(0, 0), legs(0, 0)], legs(400, 0));
  assertSumsTo(out, legs(400, 0));
  assert.equal(out[0].cashAmount, 0);
  assert.equal(out[1].cashAmount, 400);
});

test("a goodwill discount is re-attributed like any other leg", () => {
  const out = reallocateSettlements(
    [legs(500, 0, 100), legs(500, 0, 100)],
    legs(600, 0, 400),
  );
  assertSumsTo(out, legs(600, 0, 400));
  assert.deepEqual(
    out.map((r) => r.discountAmount),
    [200, 200],
  );
});

test("dropping a leg to zero empties it everywhere", () => {
  const out = reallocateSettlements(
    [legs(400, 100, 50), legs(400, 100, 50)],
    legs(1100, 0, 0),
  );
  assertSumsTo(out, legs(1100, 0, 0));
  assert.equal(sum(out, "upiAmount"), 0);
  assert.equal(sum(out, "discountAmount"), 0);
});

test("the sum invariant holds across awkward amounts", () => {
  // Deterministic sweep rather than a lucky example: every combination
  // of a few prior shapes against a few targets, all of which must sum
  // to the target to the rupee. This is the property the collections
  // report depends on.
  const priors: SettlementLegs[][] = [
    [legs(1, 0)],
    [legs(999, 1)],
    [legs(7, 7, 7)],
    [legs(1, 0), legs(2, 0)],
    [legs(333, 0), legs(1, 666)],
    [legs(50, 50), legs(1, 0), legs(0, 1)],
    [legs(0, 0, 100), legs(100, 0, 0)],
  ];
  const targets = [
    legs(0, 1),
    legs(1, 0),
    legs(1000, 0),
    legs(997, 3),
    legs(1, 1, 1),
    legs(0, 0, 777),
    legs(1234, 567, 89),
  ];
  for (const rows of priors) {
    for (const t of targets) {
      const out = reallocateSettlements(rows, t);
      assert.equal(out.length, rows.length, "row count changed");
      assertSumsTo(out, t);
    }
  }
});

test("only cash and UPI count as money; a discount never does", () => {
  // Payment.amount excludes the goodwill slice for the same reason: a
  // cut given on the floor is a reason the balance closed, not a rupee
  // that reached the till.
  assert.equal(settlementAmount(legs(300, 200, 500)), 500);
  assert.equal(settlementAmount(legs(0, 0, 900)), 0);
});

test("the headline method follows the larger slice, ties to cash", () => {
  assert.equal(settlementMethod(legs(700, 300)), "CASH");
  assert.equal(settlementMethod(legs(300, 700)), "UPI_QR");
  assert.equal(settlementMethod(legs(500, 500)), "CASH");
});
