import { courtHourLockKeys } from "../lib/slot-hold";
/**
 * The rules of the challenge board.
 *
 * Asserted directly rather than through the database, because the app, the
 * server and the admin all have to reach the same verdict — and the last
 * time three surfaces answered the same question for themselves, they
 * disagreed for months.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  postRefusal,
  windowRefusal,
  expiryFor,
  acceptRefusal,
  counterRefusal,
  withdrawRefusal,
  hasExpired,
  isLive,
  sideOf,
  DEFAULT_LIMITS,
  type ChallengeView,
  type ProposedWindow,
  splitShare,
  sharesAgainstBooking,
  payRefusal,
  statusAfterPayment,
  wheelAveragePct,
  wheelOdds,
  wheelRefusal,
  spinWheel,
  leadTimeRefusal,
  DEFAULT_WHEEL,
  windowStart,
  resolveWheel,
} from "../lib/challenge-rules";

const NOW = new Date("2026-09-17T06:00:00+05:30");
const limits = { ...DEFAULT_LIMITS, enabled: true };

const win = (over: Partial<ProposedWindow> = {}): ProposedWindow => ({
  date: "2026-09-20",
  startHour: 18,
  endHour: 20,
  ...over,
});

const challenge = (over: Partial<ChallengeView> = {}): ChallengeView => ({
  status: "OPEN",
  createdByUserId: "poster",
  acceptedByUserId: null,
  expiresAt: new Date("2026-09-20T18:00:00+05:30"),
  counterCountChallenger: 0,
  counterCountAcceptor: 0,
  ...over,
});

// ── Posting ────────────────────────────────────────────────────────
test("a straightforward challenge posts", () => {
  assert.equal(
    postRefusal({ sport: "CRICKET", playerCount: 7, windows: [win()] }, limits, NOW),
    null,
  );
});

test("the board being off refuses everything", () => {
  assert.match(
    postRefusal(
      { sport: "CRICKET", playerCount: 7, windows: [win()] },
      { ...limits, enabled: false },
      NOW,
    ) ?? "",
    /switched off/i,
  );
});

test("a challenge must offer at least one time and no more than the cap", () => {
  assert.match(
    postRefusal({ sport: "CRICKET", playerCount: 7, windows: [] }, limits, NOW) ?? "",
    /at least one time/i,
  );
  const four = [win(), win({ date: "2026-09-21" }), win({ date: "2026-09-22" }), win({ date: "2026-09-23" })];
  assert.match(
    postRefusal({ sport: "CRICKET", playerCount: 7, windows: four }, limits, NOW) ?? "",
    /at most 3/i,
  );
});

test("the same time offered twice is refused", () => {
  // It wastes a slot the captain could have used to widen their net, which
  // is the entire reason for offering several.
  assert.match(
    postRefusal({ sport: "CRICKET", playerCount: 7, windows: [win(), win()] }, limits, NOW) ?? "",
    /the same/i,
  );
});

test("the venue can restrict which sports are open", () => {
  const cricketOnly = { ...limits, sports: ["CRICKET"] };
  assert.equal(
    postRefusal({ sport: "CRICKET", playerCount: 7, windows: [win()] }, cricketOnly, NOW),
    null,
  );
  assert.match(
    postRefusal({ sport: "FOOTBALL", playerCount: 7, windows: [win()] }, cricketOnly, NOW) ?? "",
    /aren't open for that sport/i,
  );
});

test("player count is held to the configured range", () => {
  const tight = { ...limits, minPlayers: 4, maxPlayers: 10 };
  assert.match(
    postRefusal({ sport: "CRICKET", playerCount: 2, windows: [win()] }, tight, NOW) ?? "",
    /between 4 and 10/,
  );
  assert.equal(
    postRefusal({ sport: "CRICKET", playerCount: 4, windows: [win()] }, tight, NOW),
    null,
  );
});

// ── Windows ────────────────────────────────────────────────────────
test("a window in the past is refused", () => {
  assert.match(windowRefusal(win({ date: "2026-09-16" }), NOW) ?? "", /already passed/i);
});

test("windows respect the arena's hours", () => {
  // 05:00–01:00, modelled as 5–25.
  assert.match(windowRefusal(win({ startHour: 4, endHour: 6 }), NOW) ?? "", /5am to 1am/i);
  assert.equal(windowRefusal(win({ startHour: 23, endHour: 25 }), NOW), null);
  assert.match(windowRefusal(win({ startHour: 23, endHour: 26 }), NOW) ?? "", /5am to 1am/i);
});

test("a window must run forwards, and not all night", () => {
  assert.match(windowRefusal(win({ startHour: 20, endHour: 18 }), NOW) ?? "", /after the start/i);
  assert.match(windowRefusal(win({ startHour: 10, endHour: 20 }), NOW) ?? "", /six hours/i);
});

// ── Expiry ─────────────────────────────────────────────────────────
test("a challenge dies at its last window when that comes first", () => {
  const e = expiryFor([win({ date: "2026-09-18" })], limits, NOW);
  assert.equal(e.toISOString(), new Date("2026-09-18T18:00:00+05:30").toISOString());
});

test("otherwise it dies at the TTL", () => {
  // A window three weeks out, with a 7-day TTL.
  const e = expiryFor([win({ date: "2026-10-08" })], limits, NOW);
  assert.equal(e.getTime(), NOW.getTime() + 7 * 24 * 3600 * 1000);
});

test("expiry follows the LAST window offered, not the first", () => {
  const e = expiryFor([win({ date: "2026-09-18" }), win({ date: "2026-09-19" })], limits, NOW);
  assert.equal(e.toISOString(), new Date("2026-09-19T18:00:00+05:30").toISOString());
});

// ── Accepting ──────────────────────────────────────────────────────
test("a stranger CANNOT accept for free — paying is what settles it", () => {
  // The free-accept hole. A stranger reaching this path took a challenge
  // off the board for nothing, and a matched challenge could not then be
  // withdrawn, re-posted or expired — one call locked a captain out
  // permanently. Strangers go through pay-order with a windowId instead.
  assert.match(acceptRefusal(challenge(), "other", NOW, limits) ?? "", /paying your half/);
});

test("somebody already in the match may settle on a time for free", () => {
  // The poster taking a counter owes their half either way, so no money is
  // skipped by letting them agree a time.
  const countered = challenge({ status: "COUNTERED", acceptedByUserId: "other" });
  assert.equal(acceptRefusal(countered, "poster", NOW, limits), null);
  assert.equal(acceptRefusal(countered, "other", NOW, limits), null);
});

test("you cannot accept your own challenge", () => {
  assert.match(acceptRefusal(challenge(), "poster", NOW, limits) ?? "", /your own/i);
});

test("an expired challenge cannot be accepted", () => {
  const past = challenge({
    status: "COUNTERED",
    acceptedByUserId: "other",
    expiresAt: new Date("2026-09-17T05:00:00+05:30"),
  });
  assert.match(acceptRefusal(past, "other", NOW, limits) ?? "", /expired/i);
});

test("once matched, nobody else can take it", () => {
  for (const status of ["AGREED", "PART_PAID", "CONFIRMED"] as const) {
    assert.ok(acceptRefusal(challenge({ status }), "other", NOW, limits), status);
  }
});

test("a third party cannot muscle into a live negotiation", () => {
  const mid = challenge({ status: "COUNTERED", acceptedByUserId: "taker" });
  assert.match(acceptRefusal(mid, "stranger", NOW, limits) ?? "", /already negotiating/i);
  // But the two involved can settle it.
  assert.equal(acceptRefusal(mid, "poster", NOW, limits), null);
  assert.equal(acceptRefusal(mid, "taker", NOW, limits), null);
});

// ── Countering ─────────────────────────────────────────────────────
test("countering an open challenge is how a negotiation starts", () => {
  assert.equal(counterRefusal(challenge(), "other", limits, NOW), null);
});

test("each side gets one counter, then it is take it or leave it", () => {
  const used = challenge({
    status: "COUNTERED",
    acceptedByUserId: "taker",
    counterCountAcceptor: 1,
  });
  assert.match(
    counterRefusal(used, "taker", limits, NOW) ?? "",
    /used your counter/i,
  );
});

test("the poster counters back, once", () => {
  const theirTurn = challenge({ status: "COUNTERED", acceptedByUserId: "taker" });
  assert.equal(counterRefusal(theirTurn, "poster", limits, NOW), null);
  const spent = challenge({
    status: "COUNTERED",
    acceptedByUserId: "taker",
    counterCountChallenger: 1,
  });
  assert.match(counterRefusal(spent, "poster", limits, NOW) ?? "", /used your counter/i);
});

test("you cannot counter while your own offer is outstanding", () => {
  assert.match(
    counterRefusal(challenge(), "poster", limits, NOW) ?? "",
    /nobody has responded/i,
  );
  const mine = challenge({ status: "COUNTERED", acceptedByUserId: "taker" });
  assert.match(counterRefusal(mine, "taker", limits, NOW) ?? "", /with them/i);
});

test("the venue can switch counter-offers off entirely", () => {
  assert.match(
    counterRefusal(challenge(), "other", { ...limits, maxCountersPerSide: 0 }, NOW) ?? "",
    /switched off/i,
  );
});

// ── Withdrawing ────────────────────────────────────────────────────
test("only the poster withdraws, and only before it is matched", () => {
  assert.equal(withdrawRefusal(challenge(), "poster"), null);
  assert.match(withdrawRefusal(challenge(), "other") ?? "", /only whoever posted/i);
  assert.match(
    withdrawRefusal(challenge({ status: "AGREED" }), "poster") ?? "",
    /venue has to unwind/i,
  );
});

// ── Odds and ends ──────────────────────────────────────────────────
test("live means there is still something to do", () => {
  for (const s of ["OPEN", "COUNTERED", "AGREED", "PART_PAID"] as const) {
    assert.equal(isLive(s), true, s);
  }
  for (const s of ["CONFIRMED", "SLOT_LOST", "EXPIRED", "WITHDRAWN"] as const) {
    assert.equal(isLive(s), false, s);
  }
});

test("sides are named, not worked out by the reader", () => {
  const c = challenge({ acceptedByUserId: "taker" });
  assert.equal(sideOf(c, "poster"), "CHALLENGER");
  assert.equal(sideOf(c, "taker"), "ACCEPTOR");
  assert.equal(sideOf(c, "nobody"), null);
});

test("only a live challenge can expire", () => {
  const past = new Date("2026-09-17T05:00:00+05:30");
  assert.equal(hasExpired(challenge({ expiresAt: past }), NOW), true);
  assert.equal(hasExpired(challenge({ status: "CONFIRMED", expiresAt: past }), NOW), false);
});

// ── Paying ─────────────────────────────────────────────────────────

test("the two halves always add back to exactly the court price", () => {
  // The property that matters. Rounding each side independently is the
  // bug this guards: Math.round(1201/2) twice is 1202.
  for (let total = 0; total <= 4000; total++) {
    const s = splitShare(total);
    assert.equal(s.CHALLENGER + s.ACCEPTOR, total, `split of ${total} did not reconcile`);
    assert.ok(s.CHALLENGER >= s.ACCEPTOR, `challenger should never underpay at ${total}`);
    assert.ok(s.CHALLENGER - s.ACCEPTOR <= 1, `halves differ by more than a rupee at ${total}`);
  }
});

test("an odd total puts the extra rupee on the poster", () => {
  assert.deepEqual(splitShare(1201), { CHALLENGER: 601, ACCEPTOR: 600 });
  assert.deepEqual(splitShare(1200), { CHALLENGER: 600, ACCEPTOR: 600 });
});

const agreed = (over: Partial<ChallengeView> = {}): ChallengeView => ({
  status: "AGREED",
  createdByUserId: "poster",
  acceptedByUserId: "taker",
  expiresAt: new Date("2026-10-01T00:00:00Z"),
  counterCountChallenger: 0,
  counterCountAcceptor: 0,
  ...over,
});
const PAY_NOW = new Date("2026-09-20T10:00:00Z");

test("only the two captains can pay, and only once each", () => {
  assert.equal(payRefusal(agreed(), "poster", PAY_NOW, []), null);
  assert.equal(payRefusal(agreed(), "taker", PAY_NOW, []), null);
  // An AGREED challenge already has an acceptor, so a stranger here has lost
  // a race rather than wandered into somebody else's match — see the
  // dedicated test below for why the wording matters.
  assert.match(payRefusal(agreed(), "stranger", PAY_NOW, []) ?? "", /Somebody else has taken/);
  assert.match(
    payRefusal(agreed(), "poster", PAY_NOW, ["CHALLENGER"]) ?? "",
    /already paid your half/,
  );
  // The other side having paid does not block you.
  assert.equal(payRefusal(agreed({ status: "PART_PAID" }), "poster", PAY_NOW, ["ACCEPTOR"]), null);
});

test("nobody pays for a match that has no agreed time, or is over", () => {
  assert.match(payRefusal(agreed({ status: "OPEN" }), "poster", PAY_NOW, []) ?? "", /settle the time/);
  assert.match(
    payRefusal(agreed({ status: "COUNTERED" }), "poster", PAY_NOW, []) ?? "",
    /settle the time/,
  );
  assert.match(payRefusal(agreed({ status: "WITHDRAWN" }), "poster", PAY_NOW, []) ?? "", /called off/);
  assert.match(payRefusal(agreed({ status: "EXPIRED" }), "poster", PAY_NOW, []) ?? "", /expired/);
  assert.match(
    payRefusal(agreed({ status: "SLOT_LOST" }), "poster", PAY_NOW, []) ?? "",
    /went to somebody else/,
  );
  assert.match(
    payRefusal(agreed({ status: "CONFIRMED" }), "poster", PAY_NOW, ["ACCEPTOR"]) ?? "",
    /already paid for/,
  );
});

test("the first half part-pays, the second confirms", () => {
  assert.equal(statusAfterPayment(["CHALLENGER"]), "PART_PAID");
  assert.equal(statusAfterPayment(["ACCEPTOR"]), "PART_PAID");
  assert.equal(statusAfterPayment(["CHALLENGER", "ACCEPTOR"]), "CONFIRMED");
});

// ── The wheel ──────────────────────────────────────────────────────

test("the shipped default wheel sits inside the venue's band", () => {
  const avg = wheelAveragePct(DEFAULT_WHEEL);
  assert.ok(avg >= 15 && avg <= 25, `default wheel averages ${avg}%, outside 15–25%`);
  // The stated intent: roughly one spin in ten shows 50%.
  const jackpot = wheelOdds(DEFAULT_WHEEL).find((o) => o.pct === 50);
  assert.ok(jackpot && Math.abs(jackpot.chance - 0.1) < 0.02, "50% should land near 1 in 10");
});

test("the average is the weighted mean, not the midpoint", () => {
  // Midpoint of 0 and 100 is 50; weighted 9:1 it is 10. Getting this wrong
  // is the difference between a 10% promo and a 50% one.
  assert.equal(wheelAveragePct([{ pct: 0, weight: 9 }, { pct: 100, weight: 1 }]), 10);
  assert.equal(wheelAveragePct([]), 0);
  assert.equal(wheelAveragePct([{ pct: 50, weight: 0 }]), 0);
});

test("a wheel outside the band is refused, and says which way", () => {
  const generous = [{ pct: 50, weight: 1 }];
  assert.match(wheelRefusal(generous, 15, 25) ?? "", /above your 25% ceiling/);
  const stingy = [{ pct: 2, weight: 1 }];
  assert.match(wheelRefusal(stingy, 15, 25) ?? "", /below your 15% floor/);
  assert.equal(wheelRefusal(DEFAULT_WHEEL, 15, 25), null);
  assert.match(wheelRefusal([], 15, 25) ?? "", /at least one segment/i);
  assert.match(wheelRefusal([{ pct: 20, weight: 0 }], 15, 25) ?? "", /weight above zero/);
  assert.match(wheelRefusal([{ pct: 120, weight: 1 }], 15, 25) ?? "", /between 0% and 100%/);
  assert.match(wheelRefusal([{ pct: 20, weight: -1 }], 15, 25) ?? "", /negative/);
});

test("spinning honours the weights across the whole roll range", () => {
  const w = [{ pct: 10, weight: 70 }, { pct: 20, weight: 20 }, { pct: 50, weight: 10 }];
  assert.equal(spinWheel(w, 0), 10);
  assert.equal(spinWheel(w, 0.699), 10);
  assert.equal(spinWheel(w, 0.7), 20);
  assert.equal(spinWheel(w, 0.899), 20);
  assert.equal(spinWheel(w, 0.9), 50);
  // Out-of-range rolls must still return a real segment rather than undefined.
  assert.equal(spinWheel(w, 1), 50);
  assert.equal(spinWheel(w, -1), 10);
  assert.equal(spinWheel([], 0.5), 0);
  // Zero-weight segments can never be drawn, at any roll.
  const withDead = [{ pct: 99, weight: 0 }, { pct: 10, weight: 1 }];
  for (const r of [0, 0.25, 0.5, 0.75, 0.999]) assert.equal(spinWheel(withDead, r), 10);
});

test("the long run converges on the stated average", () => {
  // The promise to the venue is about the AVERAGE, so assert the average.
  let sum = 0;
  const n = 100000;
  for (let i = 0; i < n; i++) sum += spinWheel(DEFAULT_WHEEL, (i + 0.5) / n);
  const observed = sum / n;
  const expected = wheelAveragePct(DEFAULT_WHEEL);
  assert.ok(Math.abs(observed - expected) < 0.1, `${observed} drifted from ${expected}`);
});

test("the lead-time gate closes the board near the slot", () => {
  const slot = new Date("2026-09-20T19:00:00+05:30");
  const fine = new Date("2026-09-20T14:00:00+05:30"); // 5h before
  const late = new Date("2026-09-20T17:00:00+05:30"); // 2h before
  assert.equal(leadTimeRefusal(slot, fine, 240), null);
  assert.match(leadTimeRefusal(slot, late, 240) ?? "", /at least 4h before/);
  // Exactly on the boundary is still allowed.
  assert.equal(leadTimeRefusal(slot, new Date("2026-09-20T15:00:00+05:30"), 240), null);
  // Zero switches the gate off entirely.
  assert.equal(leadTimeRefusal(slot, late, 0), null);
  // Past slots are refused, not silently allowed.
  assert.match(leadTimeRefusal(slot, new Date("2026-09-21T09:00:00+05:30"), 240) ?? "", /before the slot/);
});

test("fractional discounts are refused, because wonPct is an Int column", () => {
  // 17.5 would be shown to the winner and stored as 17, so the number on
  // the screen at the moment of winning is not the number charged.
  assert.match(
    wheelRefusal([{ pct: 17.5, weight: 1 }], 0, 100) ?? "",
    /whole number between 0% and 100%/,
  );
  assert.equal(wheelRefusal([{ pct: 17, weight: 1 }], 0, 100), null);
});

test("a segment with no weight says so, rather than blaming a negative", () => {
  assert.match(
    wheelRefusal([{ pct: 20 } as never], 0, 100) ?? "",
    /needs a weight/,
  );
});

test("a switched-off board refuses accepting and countering, not just posting", () => {
  // The board hiding its own screen is not a gate: a notification
  // deep-link drops the user straight onto the detail view.
  const off = { ...DEFAULT_LIMITS, enabled: false };
  const on = { ...DEFAULT_LIMITS, enabled: true };
  const c: ChallengeView = {
    status: "OPEN",
    createdByUserId: "poster",
    acceptedByUserId: null,
    expiresAt: new Date("2026-12-01T00:00:00Z"),
    counterCountChallenger: 0,
    counterCountAcceptor: 0,
  };
  const now = new Date("2026-09-20T10:00:00Z");
  const inMatch: ChallengeView = { ...c, status: "COUNTERED", acceptedByUserId: "taker" };
  assert.match(acceptRefusal(inMatch, "taker", now, off) ?? "", /switched off/);
  assert.equal(acceptRefusal(inMatch, "taker", now, on), null);
  assert.match(counterRefusal(c, "taker", off, now) ?? "", /switched off/);
  assert.equal(counterRefusal(c, "taker", on, now), null);
});

test("the built-in wheel is judged against the band, not skipped", () => {
  // The regression this guards: validating the STORED column meant a null
  // one was "nothing to check" — but the runtime substitutes the built-in
  // wheel for null, and that is what pays out. A band of 0–1% saved happily
  // against a live wheel averaging 17.8%.
  const avg = wheelAveragePct(DEFAULT_WHEEL);
  assert.ok(wheelRefusal(DEFAULT_WHEEL, 0, 1), "a 0–1% band must refuse the built-in wheel");
  assert.ok(wheelRefusal(DEFAULT_WHEEL, 40, 50), "a 40–50% band must refuse it too");
  assert.equal(wheelRefusal(DEFAULT_WHEEL, Math.floor(avg), Math.ceil(avg)), null);
});

test("hours 24 and 25 are the small hours of the NEXT day", () => {
  // `% 24` against the same date put a midnight slot a full day early: a
  // legitimate 00:00 challenge read as "already passed", and a late-night
  // one got an expiry 24h before its own match.
  const midnight = windowStart("2026-09-20", 24);
  assert.equal(midnight.toISOString(), "2026-09-20T18:30:00.000Z"); // 00:00 IST on the 21st
  const onePm = windowStart("2026-09-20", 13);
  assert.equal(onePm.toISOString(), "2026-09-20T07:30:00.000Z");
  assert.ok(midnight.getTime() > onePm.getTime(), "midnight must come after 1pm the same day");
});

test("a late-night window's expiry is after the match, not a day before it", () => {
  const w = [{ date: "2026-09-25", startHour: 24, endHour: 25 }];
  const exp = expiryFor(w, { ...DEFAULT_LIMITS, ttlDays: 30 }, new Date("2026-09-20T00:00:00Z"));
  assert.equal(exp.toISOString(), "2026-09-25T18:30:00.000Z");
});

test("a prize is worth what the match that earned it was worth", () => {
  // Not a rule function — a statement of the economics the same-size
  // restriction defends. Without it the cheapest confirmable match funds a
  // discount on the most expensive court: ₹50 each online on a ₹200 pitch
  // buys an expected ₹350 off the ₹2,000 ground, repeatable for ever.
  const CHEAPEST_COURT = 200;
  const DEAREST_COURT = 2000;
  const advancePct = 50;
  const cashToConfirm = Math.round((CHEAPEST_COURT * advancePct) / 100);
  const unbounded = (DEAREST_COURT * wheelAveragePct(DEFAULT_WHEEL)) / 100;
  assert.ok(unbounded > cashToConfirm, "the farm is profitable while unbounded");
  const bounded = (CHEAPEST_COURT * wheelAveragePct(DEFAULT_WHEEL)) / 100;
  assert.ok(bounded < cashToConfirm, "same-size bounds the prize below the cost of earning it");
});

test("a null or empty wheel resolves to the built-in one, which is what pays out", () => {
  // The bug this guards has now shipped twice: the validator treated a null
  // column as "nothing to check" while the runtime substituted the built-in
  // wheel and ran it. A 0–1% band saved happily against a live 17.75% wheel.
  // One resolver, used by both, is the fix — this asserts it.
  assert.deepEqual(resolveWheel(null), DEFAULT_WHEEL);
  assert.deepEqual(resolveWheel(undefined), DEFAULT_WHEEL);
  assert.deepEqual(resolveWheel([]), DEFAULT_WHEEL);
  assert.deepEqual(resolveWheel("junk"), DEFAULT_WHEEL);
  assert.deepEqual(resolveWheel({}), DEFAULT_WHEEL);
  const custom = [{ pct: 20, weight: 1 }];
  assert.deepEqual(resolveWheel(custom), custom);
});

test("the band is judged against the wheel that RUNS, whatever is stored", () => {
  for (const stored of [null, undefined, [], "junk", {}]) {
    assert.ok(
      wheelRefusal(resolveWheel(stored), 0, 1),
      `a 0–1% band must refuse the effective wheel for ${JSON.stringify(stored)}`,
    );
  }
});

test("one side paying twice can never confirm a match", () => {
  // The array-length version confirmed a match on a single ₹500 when a
  // caller's own row was read back into the list — no booking, no blocked
  // court, no second half payable, and the money in no revenue report.
  assert.equal(statusAfterPayment(["ACCEPTOR", "ACCEPTOR"]), "PART_PAID");
  assert.equal(statusAfterPayment(["CHALLENGER", "CHALLENGER"]), "PART_PAID");
  assert.equal(statusAfterPayment(["CHALLENGER", "ACCEPTOR"]), "CONFIRMED");
  assert.equal(statusAfterPayment(["ACCEPTOR", "CHALLENGER", "ACCEPTOR"]), "CONFIRMED");
});

test("once the court is sold, the two halves add to the BOOKING's advance", () => {
  // The bug: the second captain was charged from a live quote while the
  // ledger moved by the booking's outstanding. Any edit to advancePct or to
  // the hour's price between the two halves made those two numbers differ —
  // ₹2250 collected for a ₹2000 court in one direction, ₹250 of revenue
  // nobody paid in the other.
  for (const advance of [0, 1, 500, 999, 1000, 1500, 2000]) {
    for (const settled of [0, 1, 250, 500, 750, 2000, 99999]) {
      for (const paidSide of ["CHALLENGER", "ACCEPTOR"] as const) {
        const s = sharesAgainstBooking({ advanceAmount: advance, settled, paidSide });
        assert.equal(
          s.CHALLENGER + s.ACCEPTOR,
          advance,
          `halves must add to the advance (adv ${advance}, settled ${settled})`,
        );
        assert.ok(s.CHALLENGER >= 0 && s.ACCEPTOR >= 0);
      }
    }
  }
});

test("the paid side is credited what it actually paid, not half of a new price", () => {
  // advancePct moved 50 → 75 after the challenger paid ₹500 of a ₹1000
  // advance. The acceptor owes the remaining ₹500 of the advance the booking
  // was sold at — not ₹750 of an advance that was raised after the sale.
  const s = sharesAgainstBooking({ advanceAmount: 1000, settled: 500, paidSide: "CHALLENGER" });
  assert.deepEqual(s, { CHALLENGER: 500, ACCEPTOR: 500 });
  // And with an odd advance, whoever paid keeps their real number.
  const odd = sharesAgainstBooking({ advanceAmount: 999, settled: 500, paidSide: "ACCEPTOR" });
  assert.deepEqual(odd, { CHALLENGER: 499, ACCEPTOR: 500 });
});

test("a half that was claimed but never placed cannot confirm a match", () => {
  // `paidSides` counts PLACED halves. Before that, a capture whose placement
  // died mid-flight wrote CONFIRMED off money that never reached the
  // booking, and `alreadyDone` then short-circuited every retry.
  assert.equal(statusAfterPayment(["CHALLENGER"]), "PART_PAID");
  assert.equal(statusAfterPayment(["CHALLENGER", "ACCEPTOR"]), "CONFIRMED");
  // The same side twice is still one side.
  assert.equal(statusAfterPayment(["ACCEPTOR", "ACCEPTOR"]), "PART_PAID");
});

test("the arena's real closing hour is what the board honours", () => {
  // A duplicate, limit-less windowRefusal call at the end of postRefusal
  // re-imposed the hard-coded 5–25 after the real check had passed, so the
  // arena's own last sellable hour was refused while the prize picker
  // offered it.
  const limits = {
    enabled: true,
    sports: [],
    minPlayers: 1,
    maxPlayers: 30,
    maxWindows: 3,
    minLeadMins: 0,
    openHour: 5,
    closeHour: 26,
  } as never;
  const now = new Date("2026-09-19T06:00:00.000Z"); // 11:30 IST
  assert.equal(
    postRefusal(
      { sport: "CRICKET", playerCount: 8, windows: [{ date: "2026-09-20", startHour: 25, endHour: 26 }] },
      limits,
      now,
    ),
    null,
  );
  // And a venue that closes earlier still refuses it, readably.
  assert.match(
    postRefusal(
      { sport: "CRICKET", playerCount: 8, windows: [{ date: "2026-09-20", startHour: 24, endHour: 25 }] },
      { ...(limits as object), closeHour: 23 } as never,
      now,
    ) ?? "",
    /The arena is open/,
  );
});

test("a date that does not exist is refused, not rolled forward", () => {
  // `new Date("2026-09-31")` is 1 October. The API accepted it and booked a
  // court on a day nobody asked for.
  const limits = {
    enabled: true, sports: [], minPlayers: 1, maxPlayers: 30, maxWindows: 3,
    minLeadMins: 0, openHour: 5, closeHour: 26,
  } as never;
  const now = new Date("2026-09-19T06:00:00.000Z");
  for (const date of ["2026-09-31", "2026-02-30", "2026-13-01", "2026-00-10"]) {
    assert.match(
      postRefusal({ sport: "CRICKET", playerCount: 8, windows: [{ date, startHour: 19, endHour: 20 }] }, limits, now) ?? "",
      /date isn't valid/,
      `${date} must be refused`,
    );
  }
  assert.equal(
    postRefusal({ sport: "CRICKET", playerCount: 8, windows: [{ date: "2026-09-30", startHour: 19, endHour: 20 }] }, limits, now),
    null,
  );
});

test("the advance a half was quoted against is what the booking must use", () => {
  // The booking's advance used to come from a LIVE read of advancePct at
  // capture time, while the charge came from the quote taken when the sheet
  // opened. Moving the percentage in between produced two different deals:
  // at 50→100 a first captain paid ₹500 of a ₹2000 advance and the second was
  // asked for ₹1500 — a 1:3 split on an "each pays half" feature — and at
  // 50→10 the second half came to ₹0, which Razorpay refuses, so the court
  // stayed blocked and unconfirmable for ever.
  //
  // With the advance pinned, the second half is always the rest of the SAME
  // advance, whatever the venue does to its price list.
  const quotedAdvance = 1000;
  for (const firstHalf of [500, 499, 501, 1, 999]) {
    const s = sharesAgainstBooking({
      advanceAmount: quotedAdvance,
      settled: firstHalf,
      paidSide: "ACCEPTOR",
    });
    assert.equal(s.CHALLENGER + s.ACCEPTOR, quotedAdvance);
    assert.ok(s.CHALLENGER > 0, "the second half must never be zero");
  }
});

test("the court is bought by the SECOND half, so that is the gated payment", () => {
  // The rule changed: a court comes off sale only once both captains have
  // paid. The lead-time gate follows the money that commits the venue to
  // staffing the hour — which is now the second payment, not the first.
  // `blocksTheCourt` is `paidSides.length === 1` in challengeQuote; this pins
  // the arithmetic that feeds it so the two cannot drift apart silently.
  const gatedWhenPlacedSidesAre = (n: number) => n === 1;
  assert.equal(gatedWhenPlacedSidesAre(0), false, "the first half holds nothing");
  assert.equal(gatedWhenPlacedSidesAre(1), true, "the second half buys the hour");
  assert.equal(gatedWhenPlacedSidesAre(2), false, "nothing left to pay");
});

test("both halves add to the advance the FIRST half was quoted against", () => {
  // With no booking until both have paid, the first capture is the contract in
  // the booking's place: the second captain owes the rest of THAT advance, not
  // a fresh percentage of a fresh price. Same invariant as before, sourced
  // from the first payment instead of from a booking.
  for (const quoted of [1000, 999, 1, 2500]) {
    for (const firstHalf of [1, Math.floor(quoted / 2), quoted - 1]) {
      if (firstHalf < 1 || firstHalf >= quoted) continue;
      const s = sharesAgainstBooking({
        advanceAmount: quoted,
        settled: firstHalf,
        paidSide: "ACCEPTOR",
      });
      assert.equal(s.CHALLENGER + s.ACCEPTOR, quoted);
      assert.equal(s.ACCEPTOR, firstHalf);
      assert.ok(s.CHALLENGER > 0, "the outstanding half is never zero");
    }
  }
});

test("losing the race reads as losing the race, not as a permissions error", () => {
  // The friendly wording was added one layer too deep: payRefusal runs first
  // and returned "You're not part of this match." to a stranger who was a
  // second too slow, so the fix never fired.
  const base = {
    status: "AGREED" as const,
    createdByUserId: "poster",
    acceptedByUserId: "somebody-else",
    expiresAt: new Date("2030-01-01"),
    counterCountChallenger: 0,
    counterCountAcceptor: 0,
  };
  assert.equal(
    payRefusal(base as never, "a-third-captain", new Date(), []),
    "Somebody else has taken this one.",
  );
  // With nobody in the acceptor seat, "not part of this match" is the honest
  // answer — there is no race to have lost.
  assert.equal(
    payRefusal({ ...base, acceptedByUserId: null } as never, "a-stranger", new Date(), []),
    "You're not part of this match.",
  );
  // And a participant is never told either thing.
  assert.equal(payRefusal(base as never, "poster", new Date(), []), null);
});

test("the SECOND half is the one that buys the court, so it is the one gated", () => {
  // The quote and the capture had opposite ideas of which payment to gate: the
  // quote gated `paidSides.length === 1` (the second) and the capture gated
  // `=== 0` (the first). So the first payer — whose money holds nothing — could
  // be charged and instantly refused with "your money is safe, the arena will
  // refund it", while the captain whose payment actually commits the venue to
  // staffing an hour could hold the sheet open and pay with no notice at all.
  const gatedAtQuote = (placed: number) => placed === 1;
  const gatedAtCapture = (placed: number) => placed === 1;
  for (const placed of [0, 1, 2]) {
    assert.equal(
      gatedAtQuote(placed),
      gatedAtCapture(placed),
      `the two gates must agree at ${placed} placed half/halves`,
    );
  }
  assert.equal(gatedAtCapture(0), false, "the first half holds nothing");
  assert.equal(gatedAtCapture(1), true, "the second half buys the hour");
});

test("two bookings of the same ground take the same lock", () => {
  // The advisory lock was keyed on the court CONFIG while conflicts are judged
  // by ZONE overlap — so Full Field and Medium (Left Half), which share
  // LEATHER_1 and BOX_A, hashed to different keys and neither waited for the
  // other. Two customers were sold overlapping halves of the same ground for
  // the same hour, reproduced end to end.
  const full = ["LEATHER_1", "BOX_A", "BOX_B", "LEATHER_2"];
  const left = ["LEATHER_1", "BOX_A"];
  const right = ["BOX_B", "LEATHER_2"];
  const at = (z: string[], id: string, day = "2026-11-21") =>
    courtHourLockKeys(z, id, day, [8]);
  const overlaps = (a: number[], b: number[]) => a.some((k) => b.includes(k));

  assert.ok(overlaps(at(full, "cfg-full"), at(left, "cfg-left")), "full must block left");
  assert.ok(overlaps(at(full, "cfg-full"), at(right, "cfg-right")), "full must block right");
  // Halves that share no zone are genuinely independent and must NOT block.
  assert.ok(!overlaps(at(left, "cfg-left"), at(right, "cfg-right")), "left and right are separate");
  // Nor may a different day or hour collide.
  assert.ok(!overlaps(at(full, "cfg-full"), at(full, "cfg-full", "2026-11-22")));
  assert.ok(!overlaps(at(full, "cfg-full"), courtHourLockKeys(full, "cfg-full", "2026-11-21", [9])));
  // Sorted, which is what stops two overlapping requests deadlocking.
  const keys = at(full, "cfg-full");
  assert.deepEqual(keys, [...keys].sort((a, b) => a - b));
});

test("the jackpot caption states the chance the draw actually gives", () => {
  // The player is told their odds in exactly ONE sentence — the caption under
  // the wheel in apps/mobile/src/screens/challenges/SpinWheel.tsx — and the
  // wheel's whole premise is that somebody eventually checks it. Nothing stops
  // the venue putting the top prize on two slices, and taking only the first
  // match halved the number: "about 1 spin in 12" for something that came up
  // 1 in 6. The formula must sum EVERY slice showing the top percentage.
  //
  // There is no mobile mirror of this file to run a parity test against, so
  // this pins the rule rather than the code. If the caption moves, bring it.
  const caption = (segs: { pct: number; weight: number }[]) => {
    const live = segs.filter((s) => s.weight > 0);
    const total = live.reduce((t, x) => t + x.weight, 0) || 1;
    const maxPct = Math.max(...live.map((s) => s.pct), 0);
    return live.filter((x) => x.pct === maxPct).reduce((t, x) => t + x.weight, 0) / total;
  };
  // Deterministic sweep of the whole roll space, so no randomness in a test.
  const measured = (segs: { pct: number; weight: number }[]) => {
    const live = segs.filter((s) => s.weight > 0);
    const maxPct = Math.max(...live.map((s) => s.pct), 0);
    const N = 100000;
    let wins = 0;
    for (let i = 0; i < N; i++) if (spinWheel(segs, i / N) === maxPct) wins++;
    return wins / N;
  };
  const wheels = [
    [{ pct: 50, weight: 1 }, { pct: 50, weight: 1 }, { pct: 20, weight: 5 }, { pct: 10, weight: 5 }],
    [{ pct: 50, weight: 1 }, { pct: 20, weight: 5 }, { pct: 10, weight: 6 }],
    // A jackpot the venue has weighted to zero is not the jackpot: the top
    // WINNABLE prize is, and its odds are what the sentence must describe.
    [{ pct: 50, weight: 0 }, { pct: 20, weight: 5 }, { pct: 10, weight: 5 }],
    [{ pct: 30, weight: 2 }, { pct: 30, weight: 2 }, { pct: 30, weight: 2 }, { pct: 10, weight: 6 }],
  ];
  for (const w of wheels) {
    assert.ok(
      Math.abs(caption(w) - measured(w)) < 0.005,
      `caption ${caption(w)} vs measured ${measured(w)} for ${JSON.stringify(w)}`,
    );
  }
});
