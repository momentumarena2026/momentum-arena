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
  assert.match(payRefusal(agreed(), "stranger", PAY_NOW, []) ?? "", /not part of this match/);
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
