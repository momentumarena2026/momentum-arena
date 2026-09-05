/**
 * Camp pricing: a recurring monthly fee plus a one-time joining fee.
 *
 * The joining fee is charged on a participant's FIRST confirmed
 * registration for a camp and never again, so a first payment is
 * registration + monthly and every renewal is monthly alone. It sits in
 * front of real money, so the arithmetic is pinned here rather than
 * being re-derived at three call sites.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { priceCampRegistration } from "../lib/camps";

const BASE = { monthlyFee: 2000, registrationFee: 500, discount: 0, pointsRupees: 0 };

test("a first registration pays both fees", () => {
  const p = priceCampRegistration({ ...BASE, firstTime: true });
  assert.equal(p.monthly, 2000);
  assert.equal(p.joining, 500);
  assert.equal(p.total, 2500);
});

test("a renewal pays the monthly fee alone", () => {
  const p = priceCampRegistration({ ...BASE, firstTime: false });
  assert.equal(p.joining, 0);
  assert.equal(p.total, 2000, "the joining fee is charged once, not every month");
});

test("no joining fee configured means nothing changes", () => {
  // Every camp that exists today has registrationFee 0, and must keep
  // pricing exactly as it did before this feature.
  for (const firstTime of [true, false]) {
    const p = priceCampRegistration({ ...BASE, registrationFee: 0, firstTime });
    assert.equal(p.total, 2000, String(firstTime));
    assert.equal(p.joining, 0, String(firstTime));
  }
});

test("coupons and points discount the monthly fee, not the joining fee", () => {
  // A promotion on a camp's monthly price should not quietly waive the
  // venue's cost of enrolling someone — and this is also exactly what
  // discounts did before joining fees existed.
  const p = priceCampRegistration({
    ...BASE,
    discount: 300,
    pointsRupees: 200,
    firstTime: true,
  });
  assert.equal(p.monthly, 1500);
  assert.equal(p.joining, 500, "untouched");
  assert.equal(p.total, 2000);
});

test("a discount larger than the monthly fee cannot make the total negative", () => {
  const p = priceCampRegistration({
    ...BASE,
    discount: 9999,
    firstTime: true,
  });
  assert.equal(p.monthly, 0, "floored, not negative");
  assert.equal(p.total, 500, "the joining fee still stands");
});

test("a free camp can still carry a joining fee", () => {
  const p = priceCampRegistration({
    monthlyFee: 0,
    registrationFee: 750,
    discount: 0,
    pointsRupees: 0,
    firstTime: true,
  });
  assert.equal(p.total, 750);
});

test("a negative joining fee is treated as none", () => {
  const p = priceCampRegistration({ ...BASE, registrationFee: -100, firstTime: true });
  assert.equal(p.joining, 0);
  assert.equal(p.total, 2000);
});
