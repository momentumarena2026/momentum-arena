/**
 * Parity + behaviour suite for the auto-apply promo arithmetic.
 *
 * `lib/auto-apply-promo.ts` and `apps/mobile/src/lib/auto-apply-promo.ts`
 * are a declared mirrored pair — the mobile file's own header says "keep
 * IN SYNC … so the web slot page and the mobile BookSlotsScreen display
 * identical numbers for the same coupon". Nothing enforced it until now.
 * CLAUDE.md requires a parity test per mirrored pair; this is that pair's,
 * added with the commit that gave both copies a third discount type and
 * so doubled the chance of them drifting.
 *
 * ── WHAT ACTUALLY GOES WRONG HERE ─────────────────────────────────────
 * Two of the three types are LINEAR in the amount, and one is not.
 *
 *   PERCENTAGE    floor(amount × bps / 10000) — linear, so the discount
 *                 on a total equals the sum of the per-slot discounts.
 *   FLAT          min(amount, value) — not linear, but it is never
 *                 displayed per slot, so nothing depends on it.
 *   TARGET_PRICE  max(0, amount − target) — NOT linear, and it IS the
 *                 per-slot type. Call it on a three-hour total of ₹6000
 *                 with a ₹1500 target and it returns ₹4500 instead of
 *                 ₹1500: a ₹3000 giveaway that looks like a discount.
 *
 * That asymmetry is the bug this file exists to pin. The per-slot and
 * whole-total readings must agree for PERCENTAGE (they always have, which
 * is why both kinds of caller were fine) and must NOT be assumed to agree
 * for TARGET_PRICE — so `computeAutoApplyDiscountForSlots` exists, and
 * the tests below assert exactly where the two readings part company.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  computeAutoApplyDiscount as webOne,
  computeAutoApplyDiscountForSlots as webMany,
  type ActiveSportPromo as WebPromo,
} from "../lib/auto-apply-promo";
import {
  computeAutoApplyDiscount as mobileOne,
  computeAutoApplyDiscountForSlots as mobileMany,
  type ActiveSportPromo as MobilePromo,
} from "../apps/mobile/src/lib/auto-apply-promo";

/** Every promo shape the admin UI and the seeds can actually produce. */
function* promos(): Generator<WebPromo & MobilePromo> {
  for (const bps of [0, 1, 250, 1250, 2500, 5000, 10000]) {
    yield { code: "P", type: "PERCENTAGE", value: bps, percentOff: bps / 100 };
  }
  for (const rupees of [0, 1, 100, 500, 2000, 999999]) {
    yield { code: "F", type: "FLAT", value: rupees, percentOff: null };
  }
  // 1500 is the live Diwali rate; the rest bracket the real price table
  // (leather pitch ₹500/₹800, half court ₹1000/₹1200, large ₹1300/₹1500,
  // full turf ₹1600/₹2000).
  for (const target of [1, 500, 1200, 1500, 1600, 2000, 5000]) {
    yield { code: "T", type: "TARGET_PRICE", value: target, percentOff: null };
  }
}

/** Real per-slot prices from the production PricingRule table, plus edges. */
const PRICES = [0, 250, 500, 800, 1000, 1200, 1300, 1500, 1600, 2000];

test("web and mobile agree on every single-amount case", () => {
  let checked = 0;
  for (const promo of promos()) {
    for (const amount of PRICES) {
      assert.equal(
        mobileOne(amount, promo),
        webOne(amount, promo),
        `divergence at amount=${amount} ${JSON.stringify(promo)}`,
      );
      checked++;
    }
  }
  assert.ok(checked > 150, `expected a broad sweep, only checked ${checked}`);
});

test("web and mobile agree on every slot-list case", () => {
  // Including the mixed lists, which are the only ones that can tell a
  // per-slot rule from a whole-total one.
  const lists = [
    [],
    [2000],
    [1600, 2000],
    [2000, 2000, 2000],
    [1600, 1600, 2000, 2000],
    [500, 2000],
    [1200, 1300, 1500],
    [0, 2000],
  ];
  for (const promo of promos()) {
    for (const list of lists) {
      assert.equal(
        mobileMany(list, promo),
        webMany(list, promo),
        `divergence at [${list}] ${JSON.stringify(promo)}`,
      );
    }
  }
});

test("a percentage reads the same per slot as it does on the total", () => {
  // The property that let both call styles coexist. If this ever breaks,
  // the per-slot tile decoration stops summing to the checkout discount.
  for (const promo of promos()) {
    if (promo.type !== "PERCENTAGE") continue;
    for (const list of [[2000, 2000], [1600, 2000], [500, 800, 1200]]) {
      const total = list.reduce((a, b) => a + b, 0);
      assert.equal(
        webMany(list, promo),
        webOne(total, promo),
        `percentage ${promo.value}bps diverges per-slot vs total on [${list}]`,
      );
    }
  }
});

test("a target price does NOT read the same on a total — and that is the point", () => {
  // Pinned as a positive assertion rather than left as a comment,
  // because a future refactor that "simplifies" the two helpers into one
  // would silently reintroduce the ₹3000 giveaway.
  const promo: WebPromo = {
    code: "DIWALI1500",
    type: "TARGET_PRICE",
    value: 1500,
    percentOff: null,
  };
  const threeHoursPeak = [2000, 2000, 2000];
  assert.equal(webMany(threeHoursPeak, promo), 1500, "₹500 off each of three peak hours");
  assert.equal(
    webOne(6000, promo),
    4500,
    "the whole-total reading is 4500 — which is why callers holding a list must not use it",
  );
  assert.notEqual(
    webMany(threeHoursPeak, promo),
    webOne(6000, promo),
    "if these ever match, one of the two helpers has lost its meaning",
  );
});

test("the Diwali offer lands on exactly one price, in both bands", () => {
  // The whole product requirement, as arithmetic: whatever the hour, the
  // customer pays ₹1500 for the full turf. Peak is ₹2000 (17:00–26:00),
  // off-peak ₹1600.
  const promo: WebPromo = {
    code: "DIWALI1500",
    type: "TARGET_PRICE",
    value: 1500,
    percentOff: null,
  };
  for (const base of [2000, 1600]) {
    assert.equal(base - webOne(base, promo), 1500, `a ₹${base} slot must come to ₹1500`);
  }
  // A two-hour evening booking and a two-hour afternoon one both land on
  // ₹3000, which is what "one price, all day" means.
  assert.equal(webMany([2000, 2000], promo), 1000);
  assert.equal(webMany([1600, 1600], promo), 200);
  for (const list of [[2000, 2000], [1600, 1600], [2000, 1600]]) {
    const paid = list.reduce((a, b) => a + b, 0) - webMany(list, promo);
    assert.equal(paid, 1500 * list.length, `[${list}] must come to ₹${1500 * list.length}`);
  }
});

test("a slot already below the target is left alone, not raised to it", () => {
  // The per-slot floor. Without it a cheap slot would contribute a
  // NEGATIVE discount and subsidise a dearer one in the same booking —
  // so a ₹500 leather pitch booked alongside a ₹2000 box would quietly
  // reduce the saving on the box.
  const promo: WebPromo = { code: "T", type: "TARGET_PRICE", value: 1500, percentOff: null };
  assert.equal(webOne(500, promo), 0, "a ₹500 slot gets no discount and no surcharge");
  assert.equal(
    webMany([500, 2000], promo),
    500,
    "the ₹2000 slot still saves its full ₹500 next to a cheap one",
  );
});

test("every discount is non-negative and never exceeds the amount", () => {
  // Two invariants the money path depends on: a negative discount would
  // increase a bill, and one larger than the amount would mint a credit.
  for (const promo of promos()) {
    for (const amount of PRICES) {
      const d = webOne(amount, promo);
      assert.ok(d >= 0, `negative discount ${d} for ${JSON.stringify(promo)} on ${amount}`);
      if (promo.type !== "FLAT") {
        assert.ok(
          d <= amount,
          `discount ${d} exceeds amount ${amount} for ${JSON.stringify(promo)}`,
        );
      }
    }
  }
});

/**
 * `holdPayableSlotPrices` is the other half of the TARGET_PRICE path:
 * the validator reads the per-slot breakdown through it, so what it
 * leaves out of the list is money the customer does not get discounted.
 */
import { holdPayableSlotPrices } from "../lib/booking-amounts";

test("the payable slot list is the prices, in order, as stored", () => {
  assert.deepEqual(
    holdPayableSlotPrices({
      totalAmount: 5600,
      slotPrices: [
        { hour: 16, price: 1600 },
        { hour: 17, price: 2000 },
        { hour: 18, price: 2000 },
      ],
    }),
    [1600, 2000, 2000],
  );
});

test("a pass-covered slot is left out, so it is not 'discounted' too", () => {
  // A covered hour is already free. Including it would hand the customer
  // ₹500 off money they are not being asked for.
  assert.deepEqual(
    holdPayableSlotPrices({
      totalAmount: 4000,
      slotPrices: [
        { hour: 17, price: 2000 },
        { hour: 18, price: 2000 },
      ],
      passModeId: "pass_1",
      passModeCoverage: { coveredAmount: 2000, coveredSlots: [{ h: 17, m: 0, min: 60 }] },
    }),
    [2000],
  );
});

test("the :30 slot inside an hour is matched on the minute, not just the hour", () => {
  // Bowling-machine holds are half-hourly, so two slots share an hour.
  // Matching on `hour` alone would drop both when one was covered.
  assert.deepEqual(
    holdPayableSlotPrices({
      totalAmount: 500,
      slotPrices: [
        { hour: 14, minute: 0, price: 250 },
        { hour: 14, minute: 30, price: 250 },
      ],
      passModeId: "pass_1",
      passModeCoverage: { coveredAmount: 250, coveredSlots: [{ h: 14, m: 30, min: 30 }] },
    }),
    [250],
  );
});

test("an unreadable breakdown yields [], which makes the coupon refuse", () => {
  // Fails closed on purpose: an empty list is what stops a TARGET_PRICE
  // coupon being priced off a total instead of per slot.
  assert.deepEqual(holdPayableSlotPrices({ totalAmount: 2000 }), []);
  assert.deepEqual(holdPayableSlotPrices({ totalAmount: 2000, slotPrices: "nonsense" }), []);
  assert.deepEqual(
    holdPayableSlotPrices({ totalAmount: 2000, slotPrices: [{ hour: 17 }, { price: 2000 }] }),
    [],
  );
});

test("coverage is only honoured when the hold is actually in pass mode", () => {
  // `holdCourtBase` ignores coveredAmount without a passModeId, so this
  // must ignore coveredSlots on the same condition — otherwise a stale
  // snapshot left on a hold would silently shrink the discount.
  assert.deepEqual(
    holdPayableSlotPrices({
      totalAmount: 4000,
      slotPrices: [
        { hour: 17, price: 2000 },
        { hour: 18, price: 2000 },
      ],
      passModeId: null,
      passModeCoverage: { coveredAmount: 2000, coveredSlots: [{ h: 17, m: 0, min: 60 }] },
    }),
    [2000, 2000],
  );
});
