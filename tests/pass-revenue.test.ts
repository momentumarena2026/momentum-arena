/**
 * Which pass sales count as revenue.
 *
 * This is counted in nine places — the revenue chart, the KPI tiles, the
 * sport split, monthly and daily earnings, the P&L and the CA report. A
 * cancelled pass excluded from eight of them is worse than one excluded
 * from none: the totals disagree and nobody can tell which is right. The
 * repo has been bitten by exactly this class of bug before (gotcha #1 in
 * PROJECT-CONTEXT), so the rule lives in one place and this asserts every
 * site still uses it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SOLD_PASS_WHERE, UNCANCELLED_PASS_WHERE } from "../lib/pass-revenue";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("a sale counts only if money changed hands and wasn't reversed", () => {
  assert.deepEqual(SOLD_PASS_WHERE, {
    price: { gt: 0 },
    status: { not: "CANCELLED" },
  });
  // Comps and prize passes were never a sale, so price > 0 stays.
  assert.deepEqual(UNCANCELLED_PASS_WHERE, { status: { not: "CANCELLED" } });
});

test("no revenue site hand-rolls the rule any more", () => {
  // The exact strings that were duplicated across nine call sites. If one
  // comes back, a cancelled pass is silently counted again somewhere.
  for (const file of [
    "actions/admin-analytics.ts",
    "actions/admin-pnl.ts",
    "lib/reports/workers/ca.ts",
  ]) {
    const src = read(file);
    assert.ok(
      !src.includes("up.price > 0"),
      `${file} still hand-rolls the raw-SQL filter`,
    );
    assert.ok(
      !/price: \{ gt: 0 \}/.test(src),
      `${file} still hand-rolls the Prisma filter`,
    );
    assert.match(
      src,
      /SOLD_PASS_SQL|SOLD_PASS_WHERE|UNCANCELLED_PASS_WHERE/,
      `${file} must use the shared rule`,
    );
  }
});

test("cancelling reverses the sale rather than only flipping a status", () => {
  const src = read("actions/admin-passes.ts");
  // The old implementation was a one-line status update, which left the
  // money on the books and the bookings on the calendar.
  assert.match(src, /cancelledAt/, "the reversal must be dated");
  assert.match(src, /cancelBooking/, "bookings made on the pass must be cancelled");
  assert.match(
    src,
    /getPassCancellationImpact/,
    "the admin must be able to see what it will undo first",
  );
});

test("bookings are cancelled before the pass is marked", () => {
  // restorePassForBooking sets a pass back to ACTIVE when it credits
  // minutes, so marking the pass first would quietly un-cancel it.
  const src = read("actions/admin-passes.ts");
  const body = src.slice(src.indexOf("export async function cancelUserPass"));
  const cancelAt = body.indexOf("cancelBooking(");
  const markAt = body.indexOf('status: "CANCELLED",');
  assert.ok(cancelAt > 0 && markAt > 0, "both steps must be present");
  assert.ok(
    cancelAt < markAt,
    "bookings must be cancelled before the pass is marked CANCELLED",
  );
});
