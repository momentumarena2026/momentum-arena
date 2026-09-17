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
test("a stranger can accept an open challenge", () => {
  assert.equal(acceptRefusal(challenge(), "other", NOW), null);
});

test("you cannot accept your own challenge", () => {
  assert.match(acceptRefusal(challenge(), "poster", NOW) ?? "", /your own/i);
});

test("an expired challenge cannot be accepted", () => {
  const past = challenge({ expiresAt: new Date("2026-09-17T05:00:00+05:30") });
  assert.match(acceptRefusal(past, "other", NOW) ?? "", /expired/i);
});

test("once matched, nobody else can take it", () => {
  for (const status of ["AGREED", "PART_PAID", "CONFIRMED"] as const) {
    assert.ok(acceptRefusal(challenge({ status }), "other", NOW), status);
  }
});

test("a third party cannot muscle into a live negotiation", () => {
  const mid = challenge({ status: "COUNTERED", acceptedByUserId: "taker" });
  assert.match(acceptRefusal(mid, "stranger", NOW) ?? "", /already negotiating/i);
  // But the two involved can settle it.
  assert.equal(acceptRefusal(mid, "poster", NOW), null);
  assert.equal(acceptRefusal(mid, "taker", NOW), null);
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
