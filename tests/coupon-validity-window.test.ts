/**
 * Validity windows mean IST days, not UTC days.
 *
 * Every admin discount form — web coupons, web discount codes, web cafe
 * discounts, and the two app admin screens — submits `validFrom` and
 * `validUntil` as a bare "YYYY-MM-DD" from a date picker. Those strings
 * used to go straight into `new Date()`, which reads them as midnight
 * UTC: 05:30 IST.
 *
 * The cost was real and silent. NAVRATRI25 was seeded with a correct
 * 23:59:59 IST end, then hand-edited through the Edit Coupon dialog on
 * 2026-10-09 to exclude the bowling machine. That save rewrote
 * `validUntil` to midnight UTC, which would have switched the promo off
 * at 05:30 on the morning of 19 October — taking the busiest evening of
 * the festival's last day with it. The dialog still displayed
 * 19/10/2026 throughout. Nothing was going to report this; it would
 * have surfaced as customers saying the discount "stopped working".
 *
 * The property: a window an admin types as 11 Oct → 19 Oct must cover
 * every instant a customer in Mathura would call 11 Oct or 19 Oct, and
 * nothing outside them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  istValidityBound,
  istDayStartUtc,
  istDayEndUtc,
  istDateKey,
} from "../lib/ist";

const FROM = "2026-10-11";
const TO = "2026-10-19";

test("a day's bounds are IST midnight to IST midnight-less-a-millisecond", () => {
  // IST midnight is 18:30 UTC on the PREVIOUS day. This is the whole bug.
  assert.equal(istDayStartUtc(FROM).toISOString(), "2026-10-10T18:30:00.000Z");
  assert.equal(istDayEndUtc(TO).toISOString(), "2026-10-19T18:29:59.999Z");
});

test("the end of the window is the END of the day, not the start of it", () => {
  const end = istDayEndUtc(TO);
  // The old behaviour, written out so the regression is unmistakable.
  const broken = new Date(TO);
  assert.equal(broken.toISOString(), "2026-10-19T00:00:00.000Z");
  assert.ok(
    end.getTime() - broken.getTime() === 18 * 3600_000 + 29 * 60_000 + 59_999,
    "the old parse lost the last 18h29m of the final day",
  );
});

test("a 7pm slot on the last day is inside the window", () => {
  // 19 Oct 19:00 IST = 13:30 UTC. The busiest hour of the final day, and
  // precisely what the broken end-bound excluded.
  const lastEvening = new Date("2026-10-19T13:30:00.000Z");
  assert.ok(lastEvening <= istDayEndUtc(TO));
  assert.ok(new Date(TO) < lastEvening, "...and the old bound refused it");
});

test("the start bound is the milder half, but it is not harmless", () => {
  // The old start was midnight UTC = 05:30 IST, so it only refused the
  // first 5.5 hours of day one. That is not an empty set at this venue:
  // it runs past midnight, and a customer checking out at 00:30 IST on
  // 11 Oct would have been told the coupon was not valid yet.
  const afterMidnightOnDayOne = new Date("2026-10-10T19:00:00.000Z");
  assert.equal(istDateKey(afterMidnightOnDayOne), "2026-10-11");
  assert.ok(afterMidnightOnDayOne >= istDayStartUtc(FROM));
  assert.ok(afterMidnightOnDayOne < new Date(FROM), "the old bound refused it");

  // A 7am checkout was fine either way — 11 Oct 07:00 IST = 01:30 UTC,
  // already past midnight UTC. Stated so the fix is not credited with
  // repairing more than it did.
  const morning = new Date("2026-10-11T01:30:00.000Z");
  assert.ok(morning >= istDayStartUtc(FROM));
  assert.ok(morning > new Date(FROM));
});

test("the arena's after-midnight hours belong to the day that is ending", () => {
  // The venue runs past midnight. 20 Oct 00:30 IST = 19 Oct 19:00 UTC —
  // outside the window, correctly: that is the 20th in IST, and the
  // venue asked for nine days ending on the 19th.
  const afterMidnight = new Date("2026-10-19T19:00:00.000Z");
  assert.equal(istDateKey(afterMidnight), "2026-10-20");
  assert.ok(afterMidnight > istDayEndUtc(TO));
});

test("nothing outside the nine days creeps in at either edge", () => {
  // 23:59 IST on 10 Oct, and 00:00 IST on 20 Oct.
  assert.ok(new Date("2026-10-10T18:29:00.000Z") < istDayStartUtc(FROM));
  assert.ok(new Date("2026-10-19T18:30:00.000Z") > istDayEndUtc(TO));
});

test("a full timestamp is honoured as given, so the seed scripts still mean it", () => {
  // The seed path says exactly which instant it wants. Coercing that to
  // a day boundary would quietly rewrite a deliberate choice.
  const precise = "2026-10-19T23:59:59+05:30";
  assert.equal(
    istValidityBound(precise, "end").toISOString(),
    "2026-10-19T18:29:59.000Z",
  );
  // Including one that is not a boundary at all.
  assert.equal(
    istValidityBound("2026-10-15T09:00:00.000Z", "start").toISOString(),
    "2026-10-15T09:00:00.000Z",
  );
});

test("the edge argument is what distinguishes the two ends", () => {
  // Same string, two different instants — the form sends one field for
  // each and they must not be parsed identically.
  assert.notEqual(
    istValidityBound(TO, "start").getTime(),
    istValidityBound(TO, "end").getTime(),
  );
  assert.equal(istValidityBound(TO, "start").toISOString(), "2026-10-18T18:30:00.000Z");
  assert.equal(istValidityBound(TO, "end").toISOString(), "2026-10-19T18:29:59.999Z");
});

test("what is stored round-trips back to the date the admin typed", () => {
  // The form re-hydrates from the stored instant. If this drifts, each
  // save walks the window a day earlier — the failure mode that makes a
  // display bug into a data bug.
  assert.equal(istDateKey(istValidityBound(FROM, "start")), FROM);
  assert.equal(istDateKey(istValidityBound(TO, "end")), TO);
  // And the naive slice, which is what the app screens used to do.
  assert.notEqual(
    istValidityBound(FROM, "start").toISOString().slice(0, 10),
    FROM,
    "UTC-slicing a start bound reports the previous day",
  );
});
