/**
 * IST calendar arithmetic (lib/ist.ts).
 *
 * These exist because the cafe analytics used host-local date getters,
 * which mean UTC on Vercel and IST on a developer's Mac. The arena runs
 * to 1am and 45% of cafe revenue is taken between midnight and 5:30am
 * IST, so every one of those orders sat in the previous UTC day. The
 * cases below are written against real instants from that window.
 *
 * Deliberately run with TZ forced two ways in CI-independent fashion:
 * every assertion uses only the lib, which never reads process.env.TZ,
 * so these pass identically on a UTC runner and an IST laptop. That
 * property IS the fix — if someone reintroduces a local getter, the
 * suite fails on one host and not the other, which is the loudest signal
 * available without pinning the runner's timezone.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  istDateKey,
  istHour,
  istMonthKey,
  istRangeBounds,
  istWeekStartKey,
  istWeekday,
  istYearBounds,
  IST_OFFSET_MS,
} from "../lib/ist";

/** 2026-09-01 00:30 IST === 2026-08-31 19:00 UTC. The whole problem. */
const LATE_NIGHT = new Date("2026-08-31T19:00:00.000Z");

test("the offset is 5h30m", () => {
  assert.equal(IST_OFFSET_MS, 19_800_000);
});

test("a 00:30 IST order belongs to the IST day, not the UTC one", () => {
  assert.equal(LATE_NIGHT.toISOString().slice(0, 10), "2026-08-31", "UTC day");
  assert.equal(istDateKey(LATE_NIGHT), "2026-09-01", "IST day");
});

test("a 00:30 IST order on the 1st belongs to the NEW month", () => {
  // This is the exact case that would have split the Cafe tab from the
  // Overall P&L: August under host-UTC, September under IST.
  assert.equal(LATE_NIGHT.toISOString().slice(0, 7), "2026-08");
  assert.equal(istMonthKey(LATE_NIGHT), "2026-09");
});

test("late-night hours read 0-5, not 18-23", () => {
  assert.equal(istHour(LATE_NIGHT), 0);
  assert.equal(istHour(new Date("2026-08-31T19:59:00.000Z")), 1);
  assert.equal(istHour(new Date("2026-08-31T20:29:00.000Z")), 1);
  // 5:29am IST — the last instant that shifts across the UTC date line.
  assert.equal(istHour(new Date("2026-08-31T23:59:00.000Z")), 5);
  // 6:00am IST onward no longer crosses.
  assert.equal(istHour(new Date("2026-09-01T00:30:00.000Z")), 6);
});

test("weekday follows the IST day", () => {
  // 2026-08-31 is a Monday; 19:00 UTC is Tuesday 00:30 IST.
  assert.equal(LATE_NIGHT.getUTCDay(), 1, "Monday in UTC");
  assert.equal(istWeekday(LATE_NIGHT), 2, "Tuesday in IST");
});

test("day range bounds cover a full IST day", () => {
  const { from, to } = istRangeBounds("2026-09-01", "2026-09-01");
  // IST midnight is 18:30 UTC the previous evening.
  assert.equal(from.toISOString(), "2026-08-31T18:30:00.000Z");
  assert.equal(to.toISOString(), "2026-09-01T18:29:59.999Z");
  // The problem instant must fall inside its own day's range.
  assert.ok(LATE_NIGHT >= from && LATE_NIGHT <= to);
});

test("a late-night order is excluded from the PREVIOUS day's range", () => {
  const { from, to } = istRangeBounds("2026-08-31", "2026-08-31");
  assert.ok(
    LATE_NIGHT > to,
    "00:30 on the 1st must not count towards the 31st",
  );
  assert.ok(from < to);
});

test("year bounds are IST, and the boundary instant lands in the right year", () => {
  const { from, to } = istYearBounds(2026);
  assert.equal(from.toISOString(), "2025-12-31T18:30:00.000Z");
  assert.equal(to.toISOString(), "2026-12-31T18:29:59.999Z");
  // 2027-01-01 00:30 IST = 2026-12-31 19:00 UTC — a new YEAR, and the
  // old code would have booked it to 2026.
  const newYear = new Date("2026-12-31T19:00:00.000Z");
  assert.ok(newYear > to, "must fall outside FY2026");
  assert.equal(istMonthKey(newYear), "2027-01");
});

test("week starts on the IST Monday", () => {
  // Tue 2026-09-01 00:30 IST → week of Mon 2026-08-31.
  assert.equal(istWeekStartKey(LATE_NIGHT), "2026-08-31");
  // A Sunday must anchor to the Monday BEFORE it, not the one after.
  // 2026-09-06 is a Sunday; 12:00 IST = 06:30 UTC.
  const sunday = new Date("2026-09-06T06:30:00.000Z");
  assert.equal(istWeekday(sunday), 0, "Sunday");
  assert.equal(istWeekStartKey(sunday), "2026-08-31");
});

test("midday instants are unaffected — the fix is not a blanket shift", () => {
  // 2026-09-01 15:00 IST = 09:30 UTC. Same day either way; the fix must
  // not move the 55% of orders that were already correct.
  const midday = new Date("2026-09-01T09:30:00.000Z");
  assert.equal(midday.toISOString().slice(0, 10), "2026-09-01");
  assert.equal(istDateKey(midday), "2026-09-01");
  assert.equal(istHour(midday), 15);
});
