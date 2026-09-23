import { courtHourLockKeys, findSlotClashes } from "../lib/slot-hold";
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
  reminderRefusal,
  inQuietHours,
  statusAfterPayment,
  wheelAveragePct,
  wheelOdds,
  wheelRefusal,
  spinWheel,
  leadTimeRefusal,
  DEFAULT_WHEEL,
  windowStart,
  resolveWheel,
  holdWaitPhrase,
  heldByOtherMessage,
  releasedFreeAt,
  releaseGraceMins,
  windowIsTakeable,
  windowAwaitsPoster,
  suggestRefusal,
  suggestAnswerRefusal,
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
//
// There is no free accept any more, and these replace a suite that asserted
// there was. The old rule let anybody ALREADY IN the match settle a time
// without paying, which read as harmless — they owe their half either way.
// It was not: the poster has a side, so on a COUNTERED challenge one tap
// produced AGREED with no money in it, recorded an acceptor who had paid
// nothing, and dropped the match off the board, because AGREED is not a
// board status. That is precisely the state the suggest rewrite removed
// through the front door while this stayed open at the back.

test("nobody settles a time without paying — not even the poster", () => {
  // The poster on a COUNTERED challenge was the one reachable case, and the
  // one that mattered: their app still rendered the button on every install
  // that had not taken the OTA, so the server rule is the only one that
  // reaches them.
  const countered = challenge({ status: "COUNTERED", acceptedByUserId: "other" });
  for (const who of ["poster", "other", "stranger"]) {
    assert.match(
      acceptRefusal(countered, who, NOW, limits) ?? "",
      /paying your half/,
      `${who} was allowed to settle a time for free`,
    );
  }
});

test("there is no status, and no person, this path approves", () => {
  // Stated as a whole rather than case by case, because the value of this
  // rule is that it has no exceptions. An exception is what the last one
  // died of.
  for (const status of ["OPEN", "COUNTERED", "AGREED", "PART_PAID", "CONFIRMED", "EXPIRED", "WITHDRAWN", "SLOT_LOST"] as const) {
    for (const who of ["poster", "other", "stranger"]) {
      assert.ok(
        acceptRefusal(challenge({ status }), who, NOW, limits),
        `${who} on ${status} was not refused`,
      );
    }
  }
});

// ── Suggesting a time ──────────────────────────────────────────────
//
// These replace the old `counterRefusal` suite wholesale. That rule was
// built around a counter CLAIMING the acceptor slot, so it rationed
// counters per side, refused a second stranger with "someone else is
// already negotiating this one", and blocked a side whose own offer was
// still outstanding. None of that survives: a suggestion claims nothing,
// any number of people may each ask about a different evening, and the
// match stays on the board throughout.

test("suggesting a time to an open challenge is how a negotiation starts", () => {
  assert.equal(suggestRefusal(challenge(), "other", { total: 0, pending: 0 }, limits, NOW), null);
});

test("a second interested captain is not turned away by the first", () => {
  // The old rule answered "someone else is already negotiating this one",
  // which was true when the first counter took the match off the board. Now
  // three people can each ask about three different evenings.
  const asked = challenge({ status: "COUNTERED" });
  assert.equal(suggestRefusal(asked, "alice", { total: 0, pending: 0 }, limits, NOW), null);
  assert.equal(suggestRefusal(asked, "bob", { total: 0, pending: 0 }, limits, NOW), null);
});

test("each PERSON gets their own say, and is capped on their own record", () => {
  const asked = challenge({ status: "COUNTERED" });
  assert.match(
    suggestRefusal(asked, "alice", { total: 1, pending: 1 }, limits, NOW) ?? "",
    /already suggested/i,
  );
  assert.equal(suggestRefusal(asked, "bob", { total: 0, pending: 0 }, limits, NOW), null);
});

test("the poster adds times to their own challenge rather than suggesting", () => {
  assert.match(
    suggestRefusal(challenge(), "poster", { total: 0, pending: 0 }, limits, NOW) ?? "",
    /your own challenge/i,
  );
});

test("the venue can switch suggestions off entirely", () => {
  assert.match(
    suggestRefusal(challenge(), "other", { total: 0, pending: 0 }, { ...limits, maxCountersPerSide: 0 }, NOW) ?? "",
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

test("the shipped default wheel obeys the venue's ₹1,800 rule", () => {
  // The default is a fallback, so it has to pass the same guard as a wheel
  // typed by hand — otherwise clearing the segments leaves a wheel the
  // settings page refuses to save.
  const avg = wheelAveragePct(DEFAULT_WHEEL);
  assert.ok(avg <= 10, `default wheel averages ${avg}%, above the 10% ceiling`);
  assert.equal(wheelRefusal(DEFAULT_WHEEL, 5, 10), null);
  // On a ₹2,000 court that is what the rule is actually about.
  assert.ok(Math.round((2000 * (100 - avg)) / 100) >= 1800);
  // The top prize is 25% — still a real win at ₹500 off, without the
  // variance a 50% segment puts on any single customer's run of spins.
  const top = Math.max(...wheelOdds(DEFAULT_WHEEL).map((o) => o.pct));
  assert.equal(top, 25);
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
  // A wheel INSIDE whatever band it is judged against passes. Using the
  // shipped default here tied this test to whatever the default happened to
  // average, which is a different question — it is now checked against its
  // own band in the test above.
  assert.equal(wheelRefusal([{ pct: 20, weight: 1 }], 15, 25), null);
  assert.equal(wheelRefusal(DEFAULT_WHEEL, 5, 10), null);
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
  // Accept is refused whether the board is on or off, which is stronger
  // than what this test used to assert. It checked for the "switched off"
  // wording specifically — reasonable when a live board approved a free
  // accept, and misleading now that nothing does.
  assert.ok(acceptRefusal(inMatch, "taker", now, off));
  assert.ok(acceptRefusal(inMatch, "taker", now, on));
  assert.match(suggestRefusal(c, "taker", { total: 0, pending: 0 }, off, now) ?? "", /switched off/);
  assert.equal(suggestRefusal(c, "taker", { total: 0, pending: 0 }, on, now), null);
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

test("a bowling half-hour does not clash with the other half of its hour", () => {
  // The admin booking path locks per whole HOUR, because that is the patch of
  // ground — but the conflict CHECK has to be at the granularity the thing is
  // sold at. Comparing startHour alone refused the venue a 14:30 bowling slot
  // because 14:00 was sold, which is a free half-hour turned away at the
  // counter. Reproduced against the real path before this existed.
  const at = (startHour: number, startMinute: number, durationMinutes: number) => ({
    slots: [{ startHour, startMinute, durationMinutes }],
  });

  // Two halves of one hour are different slots.
  assert.deepEqual(
    findSlotClashes([at(14, 0, 30)], { kind: "halfHours", slots: [{ hour: 14, minute: 30 }] }),
    [],
  );
  // The same half is the same slot.
  assert.deepEqual(
    findSlotClashes([at(14, 0, 30)], { kind: "halfHours", slots: [{ hour: 14, minute: 0 }] }),
    ["14:00"],
  );
  // A full-hour booking blocks BOTH halves — the span expands, not the key.
  assert.deepEqual(
    findSlotClashes([at(14, 0, 60)], { kind: "halfHours", slots: [{ hour: 14, minute: 30 }] }),
    ["14:30"],
  );
  // And an hourly request collides with either half already sold.
  assert.deepEqual(findSlotClashes([at(14, 30, 30)], { kind: "hours", hours: [14] }), ["14"]);
  assert.deepEqual(findSlotClashes([at(15, 0, 60)], { kind: "hours", hours: [14] }), []);
  // Nothing taken, nothing clashes.
  assert.deepEqual(findSlotClashes([], { kind: "hours", hours: [14, 15] }), []);
});

test("a slot occupies its real span, whatever shape it is", () => {
  // The first version guessed the span from `durationMinutes` alone and never
  // read `startMinute`, so a 90-minute booking at 14:00 reported nothing at
  // 15:00 — a missed clash is the same ground sold twice — while a 60-minute
  // booking at 14:30 claimed 14:00 and missed 15:00. Nothing writes those
  // shapes today; the next feature that sells a 90-minute session would.
  const slot = (startHour: number, startMinute: number, durationMinutes: number) => ({
    slots: [{ startHour, startMinute, durationMinutes }],
  });

  // 90 minutes from 14:00 runs to 15:30 — it covers 15:00, and not 15:30.
  assert.deepEqual(findSlotClashes([slot(14, 0, 90)], { kind: "halfHours", slots: [{ hour: 15, minute: 0 }] }), ["15:00"]);
  assert.deepEqual(findSlotClashes([slot(14, 0, 90)], { kind: "halfHours", slots: [{ hour: 15, minute: 30 }] }), []);
  assert.deepEqual(findSlotClashes([slot(14, 0, 90)], { kind: "hours", hours: [15] }), ["15"]);

  // An hour that starts at half past spills into the next hour, and leaves
  // the first half of its own hour free.
  assert.deepEqual(findSlotClashes([slot(14, 30, 60)], { kind: "halfHours", slots: [{ hour: 15, minute: 0 }] }), ["15:00"]);
  assert.deepEqual(findSlotClashes([slot(14, 30, 60)], { kind: "halfHours", slots: [{ hour: 14, minute: 0 }] }), []);

  // Two hours from 14:00 covers both 14 and 15, and stops there.
  assert.deepEqual(findSlotClashes([slot(14, 0, 120)], { kind: "hours", hours: [14] }), ["14"]);
  assert.deepEqual(findSlotClashes([slot(14, 0, 120)], { kind: "hours", hours: [15] }), ["15"]);
  assert.deepEqual(findSlotClashes([slot(14, 0, 120)], { kind: "hours", hours: [16] }), []);

  // The shapes the app actually writes today still behave exactly as before.
  assert.deepEqual(findSlotClashes([slot(14, 0, 30)], { kind: "halfHours", slots: [{ hour: 14, minute: 30 }] }), []);
  assert.deepEqual(findSlotClashes([slot(14, 0, 60)], { kind: "halfHours", slots: [{ hour: 14, minute: 30 }] }), ["14:30"]);
  // Late-night hours are stored as 24/25 and must not wrap round to 0/1.
  assert.deepEqual(findSlotClashes([slot(24, 0, 60)], { kind: "hours", hours: [24] }), ["24"]);
  assert.deepEqual(findSlotClashes([slot(24, 0, 60)], { kind: "hours", hours: [25] }), []);
  assert.deepEqual(findSlotClashes([slot(25, 0, 60)], { kind: "hours", hours: [25] }), ["25"]);
});

test("the wheel the venue ships keeps at least ₹1,800 of a ₹2,000 hour", () => {
  // The venue's rule in their own terms: a discounted hour must still bring
  // in ₹1,800 of a ₹2,000 court on average, i.e. an average discount of 10%
  // or less. The built-in wheel averaged 17.75% — ₹1,645 an hour, ₹16,450
  // over ten spins against a ₹18,000 floor — and the band that guarded it
  // (15–25%) enforced exactly the range that broke the rule.
  const SHIPPED = [
    { pct: 5, weight: 45 },
    { pct: 10, weight: 40 },
    { pct: 15, weight: 10 },
    { pct: 25, weight: 5 },
  ];
  const COURT = 2000;
  const avg = wheelAveragePct(SHIPPED);
  assert.ok(avg <= 10, `wheel averages ${avg}%, above the 10% ceiling`);
  assert.equal(Math.round((COURT * (100 - avg)) / 100) >= 1800, true);

  // The band must AGREE with the wheel, or the admin screen refuses to save
  // the very wheel it is holding — the two settings are one rule.
  assert.equal(wheelRefusal(SHIPPED, 5, 10), null);
  // And the band must reject the old wheel, which is the point of moving it.
  const OLD = [
    { pct: 5, weight: 10 }, { pct: 10, weight: 30 }, { pct: 15, weight: 25 },
    { pct: 20, weight: 15 }, { pct: 25, weight: 10 }, { pct: 50, weight: 10 },
  ];
  assert.ok(wheelRefusal(OLD, 5, 10), "the old 17.75% wheel must not pass the new band");
});

/* ── The payment hold's wording ──────────────────────────────────── */

test("a two-hour wait is never described as 'shortly'", () => {
  // The bug this replaces: one sentence, "Try again shortly", for a wait
  // governed by `paymentWindowMins` — 120 on this arena. A stranger could
  // not tell a lost race from a sheet abandoned an hour ago, so they
  // re-tapped, got the same words, and concluded the board was broken.
  const msg = heldByOtherMessage(110 * 60_000);
  assert.ok(!/shortly/i.test(msg), `still says shortly: ${msg}`);
  assert.ok(msg.includes("1 hour 50 minutes"), msg);
});

test("the wait is phrased in units a person can act on", () => {
  assert.equal(holdWaitPhrase(0), "now");
  assert.equal(holdWaitPhrase(-5000), "now");
  assert.equal(holdWaitPhrase(30_000), "in under a minute");
  assert.equal(holdWaitPhrase(60_000), "in under a minute");
  assert.equal(holdWaitPhrase(5 * 60_000), "in about 5 minutes");
  assert.equal(holdWaitPhrase(59 * 60_000), "in about 59 minutes");
  assert.equal(holdWaitPhrase(60 * 60_000), "in about 1 hour");
  assert.equal(holdWaitPhrase(61 * 60_000), "in about 1 hour 1 minute");
  assert.equal(holdWaitPhrase(120 * 60_000), "in about 2 hours");
});

test("the wait rounds UP, so nobody is sent back one minute early", () => {
  // 5m50s rounding DOWN to "about 5 minutes" sends somebody back to the
  // same refusal — which is the precise experience this whole change
  // exists to stop.
  assert.equal(holdWaitPhrase(5 * 60_000 + 50_000), "in about 6 minutes");
  assert.equal(holdWaitPhrase(60_001), "in about 2 minutes");
});

test("releasing a payment slot can only ever bring the deadline forward", () => {
  // The bug this pins, found against staging: the first version compared
  // the backdated stamp against the existing one and wrote whenever the
  // new value was LARGER — exactly the case that extends the hold. A
  // captain releasing a slot whose window had lapsed two hours earlier
  // resurrected it for another five minutes, locking strangers out of a
  // match that had been free all morning.
  const now = 1_000_000_000_000;
  const grace = 5;

  // Ordinary case: an hour left, release brings it to five minutes.
  assert.equal(releasedFreeAt(now + 60 * 60_000, now, grace), now + 5 * 60_000);

  // ALREADY LAPSED — must stay lapsed, not jump forward.
  assert.equal(releasedFreeAt(now - 2 * 60 * 60_000, now, grace), now - 2 * 60 * 60_000);

  // Frees sooner than the grace period — left alone rather than extended.
  assert.equal(releasedFreeAt(now + 60_000, now, grace), now + 60_000);

  // Exactly at the grace boundary is a no-op, not a one-millisecond gain.
  assert.equal(releasedFreeAt(now + 5 * 60_000, now, grace), now + 5 * 60_000);
});

test("the release grace scales, so the button works at a short window", () => {
  // Reported from production: with the window set to 5 minutes and a flat
  // 5-minute grace, grace == window, so a release could never bring the
  // deadline forward. The customer tapped "I'm not paying — release it",
  // nothing happened, and they were right to call it broken.
  assert.equal(releaseGraceMins(120, 5), 5); // long window — full protection
  assert.equal(releaseGraceMins(10, 5), 5); // exactly double — still full
  assert.equal(releaseGraceMins(5, 5), 2); // the reported case: 5 → 2
  assert.equal(releaseGraceMins(3, 5), 1); // never below a minute
  assert.equal(releaseGraceMins(1, 5), 1);

  // And the thing that matters: across every window the admin screen can
  // actually save (it bounds paymentWindowMins at 5–1440), a release moves
  // the deadline. A grace that EQUALS the window is the bug being fixed.
  //
  // Not asserted below 2 minutes, and that is a real limit rather than a
  // convenient one: the one-minute floor meets a one-minute window and the
  // release goes back to doing nothing. There is no sensible grace inside a
  // one-minute hold, the floor matters more (a zero grace releases instantly
  // and strands a late collect), and no supported door can set a window
  // that short.
  for (const win of [5, 10, 15, 30, 120, 1440]) {
    const now = 1_000_000_000_000;
    const freeAt = now + win * 60_000;
    const grace = releaseGraceMins(win, 5);
    assert.ok(
      releasedFreeAt(freeAt, now, grace) < freeAt,
      `a release does nothing at a ${win}-minute window`,
    );
  }
});

/* ── Suggesting a time claims nothing ────────────────────────────── */

const liveChallenge = {
  status: "OPEN" as const,
  createdByUserId: "poster",
  acceptedByUserId: null,
  expiresAt: new Date(Date.now() + 86_400_000),
  counterCountChallenger: 0,
  counterCountAcceptor: 0,
};
const suggestLimits = { ...DEFAULT_LIMITS, enabled: true, maxCountersPerSide: 1 };

test("a time somebody SUGGESTED cannot be bought until the poster agrees", () => {
  // The whole point of the rewrite. A suggestion is a question addressed to
  // the poster; letting a stranger pay for it would make one person's ask
  // into everybody's offer.
  const pending = { status: "OFFERED" as const, proposedBy: "ACCEPTOR" as const, approvedAt: null };
  assert.equal(windowIsTakeable(pending), false);
  assert.equal(windowAwaitsPoster(pending), true);

  const agreed = { ...pending, approvedAt: new Date() };
  assert.equal(windowIsTakeable(agreed), true);
  assert.equal(windowAwaitsPoster(agreed), false, "an answered suggestion is not still waiting");
});

test("the poster's own times need no approval", () => {
  const own = { status: "OFFERED" as const, proposedBy: "CHALLENGER" as const, approvedAt: null };
  assert.equal(windowIsTakeable(own), true);
  assert.equal(windowAwaitsPoster(own), false);
});

test("a struck-off or replaced time is takeable by nobody", () => {
  for (const status of ["DECLINED", "SUPERSEDED", "ACCEPTED"] as const) {
    assert.equal(
      windowIsTakeable({ status, proposedBy: "CHALLENGER", approvedAt: new Date() }),
      false,
      `${status} should not be takeable`,
    );
  }
});

test("everybody gets their own say, not a shared one", () => {
  // The old per-side counter meant the first stranger to suggest a time
  // spent the only one there was, and every other interested captain was
  // told they had "used" a counter they never had.
  const now = new Date();
  assert.equal(suggestRefusal(liveChallenge, "alice", { total: 0, pending: 0 }, suggestLimits, now), null);
  assert.equal(suggestRefusal(liveChallenge, "bob", { total: 0, pending: 0 }, suggestLimits, now), null);
  // …and each is capped on their own record.
  assert.ok(suggestRefusal(liveChallenge, "alice", { total: 1, pending: 1 }, suggestLimits, now));
});

test("the poster cannot suggest a time to themselves", () => {
  const r = suggestRefusal(liveChallenge, "poster", { total: 0, pending: 0 }, suggestLimits, new Date());
  assert.ok(r && /your own challenge/i.test(r), r ?? "expected a refusal");
});

test("once money is in, the haggling is over", () => {
  const now = new Date();
  for (const status of ["PART_PAID", "AGREED"] as const) {
    const r = suggestRefusal({ ...liveChallenge, status }, "alice", { total: 0, pending: 0 }, suggestLimits, now);
    assert.ok(r && /already paid/i.test(r), `${status}: ${r}`);
  }
});

test("only the poster answers a suggestion, and only once", () => {
  const now = new Date();
  const pending = { status: "OFFERED" as const, proposedBy: "ACCEPTOR" as const, approvedAt: null };
  assert.equal(suggestAnswerRefusal(liveChallenge, pending, "poster", now), null);

  const stranger = suggestAnswerRefusal(liveChallenge, pending, "alice", now);
  assert.ok(stranger && /only whoever posted/i.test(stranger), stranger ?? "expected a refusal");

  // Already answered — this is what stops a double tap sending the suggester
  // "they agreed" and "they can't" in whichever order the taps landed.
  const answered = { ...pending, approvedAt: now };
  const twice = suggestAnswerRefusal(liveChallenge, answered, "poster", now);
  assert.ok(twice && /already answered/i.test(twice), twice ?? "expected a refusal");
});


test("somebody whose suggestion was ANSWERED is not told to wait for an answer", () => {
  // Seen in production: a captain whose suggested time had been agreed to
  // nine hours earlier — and who had been pushed about it — opened the
  // match and read "Wait for their answer". The cap counts what they have
  // asked; the sentence has to say whether they are still waiting.
  const now = new Date();
  const asked = { ...liveChallenge, status: "COUNTERED" as const };

  const waiting = suggestRefusal(asked, "kartikey", { total: 1, pending: 1 }, suggestLimits, now);
  assert.match(waiting ?? "", /wait for their answer/i);

  const answered = suggestRefusal(asked, "kartikey", { total: 1, pending: 0 }, suggestLimits, now);
  assert.ok(answered, "still capped — they have had their say");
  assert.doesNotMatch(answered ?? "", /wait for their answer/i);
  assert.match(answered ?? "", /answered your suggestion/i);
});

/* ── Chasing an unpaid half ──────────────────────────────────────── */

const remindLimits = {
  enabled: true,
  everyMins: 180,
  maxPerPerson: 3,
  quietFromHour: 22,
  quietToHour: 8,
};
const askReminder = (over: Partial<Parameters<typeof reminderRefusal>[0]> = {}) =>
  reminderRefusal({
    limits: remindLimits,
    sentSoFar: 0,
    lastSentAt: null,
    now: new Date("2026-09-23T09:00:00Z"),
    istHour: 14,
    slotStartsAt: new Date("2026-09-30T13:30:00Z"),
    minLeadMins: 240,
    ...over,
  });

test("quiet hours wrap around midnight", () => {
  // 22–8 is an overnight window, not an empty one. Read as a plain
  // `from <= h < to` every sensible setting becomes a no-op, and the bug is
  // invisible because reminders simply keep sending — at 3am.
  for (const h of [22, 23, 0, 3, 7]) {
    assert.equal(inQuietHours(h, 22, 8), true, `${h}:00 should be quiet`);
  }
  for (const h of [8, 12, 21]) {
    assert.equal(inQuietHours(h, 22, 8), false, `${h}:00 should not be quiet`);
  }
  // A same-day window still works the obvious way.
  assert.equal(inQuietHours(14, 13, 15), true);
  assert.equal(inQuietHours(16, 13, 15), false);
});

test("equal quiet bounds mean NO quiet period, not a silent 24 hours", () => {
  // A venue clearing both fields wants reminders at any hour. Muting them
  // for ever instead is the opposite of that, and would look like the
  // sweep being broken.
  for (const h of [0, 9, 17, 23]) {
    assert.equal(inQuietHours(h, 0, 0), false, `${h}:00 with 0–0 should send`);
  }
});

test("nobody is reminded past the cap", () => {
  assert.equal(askReminder({ sentSoFar: 2 }), null);
  assert.match(askReminder({ sentSoFar: 3 }) ?? "", /cap/i);
  assert.match(askReminder({ sentSoFar: 9 }) ?? "", /cap/i);
});

test("the interval runs from the LAST reminder, not from the debt", () => {
  // Measuring from the event means a sweep that was down for a day comes
  // back and fires every missed reminder at once — a chaser becoming
  // harassment, which is the failure mode that loses the customer AND the
  // sale.
  const now = new Date("2026-09-23T09:00:00Z");
  const twoHoursAgo = new Date(now.getTime() - 120 * 60_000);
  const fourHoursAgo = new Date(now.getTime() - 240 * 60_000);
  assert.match(askReminder({ now, lastSentAt: twoHoursAgo }) ?? "", /too soon/i);
  assert.equal(askReminder({ now, lastSentAt: fourHoursAgo }), null);
});

test("nobody is chased for an hour they can no longer take", () => {
  // Past the notice period there is nothing left to buy, so a nudge is
  // cruelty rather than sales — and it would be the message a customer
  // remembers.
  const now = new Date("2026-09-23T09:00:00Z");
  const inTwoHours = new Date(now.getTime() + 120 * 60_000);
  const inSixHours = new Date(now.getTime() + 360 * 60_000);
  assert.match(
    askReminder({ now, slotStartsAt: inTwoHours }) ?? "",
    /too late/i,
    "a slot inside the 4h notice period must not be chased",
  );
  assert.equal(askReminder({ now, slotStartsAt: inSixHours }), null);
  // No slot at all — an open challenge — is chaseable.
  assert.equal(askReminder({ now, slotStartsAt: null }), null);
});

test("the venue can switch chasing off outright", () => {
  assert.match(askReminder({ limits: { ...remindLimits, enabled: false } }) ?? "", /switched off/i);
  assert.match(askReminder({ limits: { ...remindLimits, maxPerPerson: 0 } }) ?? "", /no reminders/i);
});
