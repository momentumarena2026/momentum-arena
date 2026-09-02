/**
 * Behaviour suite for the Overall P&L arithmetic (lib/pnl-math.ts).
 *
 * This is money that an owner reads to decide whether the business is
 * working, so the parts that are easy to get subtly wrong are pinned
 * here: interest charged before a loan was drawn, a part-year column
 * billed a full year of interest, and a zero-income month reporting a
 * 0% margin as though it had broken even.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  isExpenseGap,
  monthlyInterest,
  monthRange,
  operatingMarginPct,
  toGranularity,
  type LoanTerms,
} from "../lib/pnl-math";

// The real structure as of 2026-09-01: ₹29,06,332 from Nakul at 12% p.a.,
// first charged in the arena's first operating month.
const LOAN: LoanTerms = {
  amount: 2_906_332,
  ratePct: 12,
  startMonth: "2026-07",
};

test("interest is not charged before the loan starts", () => {
  for (const m of ["2026-01", "2026-05", "2026-06"]) {
    assert.equal(monthlyInterest([LOAN], m), 0, `charged in ${m}`);
  }
});

test("interest starts in the loan's own month, inclusive", () => {
  assert.ok(monthlyInterest([LOAN], "2026-07") > 0);
});

test("monthly interest is one twelfth of the annual charge", () => {
  const monthly = monthlyInterest([LOAN], "2026-07");
  const annual = LOAN.amount * 0.12;
  assert.ok(
    Math.abs(monthly * 12 - annual) < 0.01,
    `12 × ${monthly} should equal ${annual}`,
  );
  // Sanity against the figure quoted to the owner.
  assert.equal(Math.round(monthly), 29_063);
});

test("interest does not compound — every month costs the same", () => {
  const a = monthlyInterest([LOAN], "2026-07");
  const b = monthlyInterest([LOAN], "2027-07");
  const c = monthlyInterest([LOAN], "2030-01");
  assert.equal(a, b);
  assert.equal(b, c);
});

test("multiple loans accumulate, each gated by its own start month", () => {
  const second: LoanTerms = {
    amount: 1_200_000,
    ratePct: 10,
    startMonth: "2026-10",
  };
  assert.equal(
    Math.round(monthlyInterest([LOAN, second], "2026-09")),
    29_063,
    "second loan not yet drawn",
  );
  assert.equal(
    Math.round(monthlyInterest([LOAN, second], "2026-10")),
    29_063 + 10_000,
    "both loans running",
  );
});

test("a zero-rate loan costs nothing", () => {
  assert.equal(
    monthlyInterest([{ amount: 500_000, ratePct: 0, startMonth: "2020-01" }], "2026-07"),
    0,
  );
});

test("yearly rollup collapses months to their year", () => {
  assert.equal(toGranularity("2026-07", "year"), "2026");
  assert.equal(toGranularity("2026-07", "month"), "2026-07");
});

test("a part-year is charged only the months it contains", () => {
  // Jul-Dec 2026 = six months of interest, not twelve. The action sums
  // per-month, so this is the property that keeps a stub year honest.
  const months = monthRange("2026-07", "2026-12");
  assert.equal(months.length, 6);
  const total = months.reduce((s, m) => s + monthlyInterest([LOAN], m), 0);
  // Rounded ONCE at the end, not per month: 29,063.32 × 6 = 174,379.92.
  // Rounding each month first and summing loses ₹2 over a half year and
  // would drift further across a full one — the action rounds the total,
  // and this pins that it keeps doing so.
  assert.equal(Math.round(total), 174_380);
  assert.notEqual(Math.round(total), 29_063 * 6);
});

test("monthRange is inclusive and crosses year boundaries", () => {
  assert.deepEqual(monthRange("2026-11", "2027-02"), [
    "2026-11",
    "2026-12",
    "2027-01",
    "2027-02",
  ]);
  assert.deepEqual(monthRange("2026-03", "2026-03"), ["2026-03"]);
});

test("monthRange never runs away when last precedes first", () => {
  assert.deepEqual(monthRange("2026-08", "2026-01"), ["2026-08"]);
});

test("margin is null, not zero, when there was no income", () => {
  assert.equal(operatingMarginPct(0, -40_000), null);
  assert.equal(operatingMarginPct(0, 0), null);
});

test("margin is negative when a month loses money", () => {
  // ₹70k income against ₹1.4L of costs = −100%.
  assert.equal(operatingMarginPct(70_000, -70_000), -100);
});

test("margin matches the Screener-style whole-percent rounding", () => {
  assert.equal(operatingMarginPct(64_468, 15_039), 23);
  assert.equal(operatingMarginPct(100, 25), 25);
});

/**
 * Build-out months are NOT an expense gap.
 *
 * Owner's ruling, 2026-09-02: until July 2026 every cost was being
 * capitalised into Expense(GENERAL), so revenue earned during the build
 * is operating profit in full with nothing to subtract. An earlier draft
 * greyed those columns out and footnoted them as unreal, which was wrong
 * — it described correct accounting as a data problem.
 */
test("pre-tracking build-out months are not flagged", () => {
  // Apr-Jun 2026: real income, no running expenses, tracking starts Jul.
  for (const m of ["2026-04", "2026-05", "2026-06"]) {
    assert.equal(isExpenseGap(m, "2026-07", 228_750, 0), false, `flagged ${m}`);
  }
});

test("a missing month AFTER tracking began is flagged", () => {
  // Somebody stopped entering expenses — this one must not read as 100%.
  assert.equal(isExpenseGap("2026-12", "2026-07", 200_000, 0), true);
});

test("the first tracked period itself is in scope", () => {
  assert.equal(isExpenseGap("2026-07", "2026-07", 200_000, 0), true);
});

test("a period with expenses is never flagged", () => {
  assert.equal(isExpenseGap("2026-08", "2026-07", 218_433, 96_899), false);
});

test("a period with no income is never flagged", () => {
  // Zero income and zero expenses is an empty month, not a gap.
  assert.equal(isExpenseGap("2026-11", "2026-07", 0, 0), false);
});

test("nothing is flagged when no expense has ever been recorded", () => {
  assert.equal(isExpenseGap("2026-08", null, 218_433, 0), false);
});
