/**
 * The free hit.
 *
 * Awarded after every no-ball. On it the batter cannot be bowled, caught,
 * LBW, stumped or hit wicket — the bowler is allowed nothing they earn off
 * the stumps. It survives the end of an over, and a free hit that is
 * itself a wide or another no-ball re-arms the one after it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { replay, validateScoreEvent, type ScoreEvent } from "../lib/public-match";

const rules = { sport: "CRICKET" } as const;
const open: ScoreEvent[] = [
  { t: "SQUAD", side: "A", players: ["Amit", "Bala", "Chetan"] },
  { t: "SQUAD", side: "B", players: ["Bowler"] },
  { t: "OPEN", striker: "Amit", nonStriker: "Bala", bowler: "Bowler" },
];

test("a no-ball arms the free hit", () => {
  assert.equal(replay(open, "CRICKET").freeHit, false, "not armed to begin with");
  assert.equal(replay([...open, { t: "NO_BALL" }], "CRICKET").freeHit, true);
});

test("a legal delivery consumes it", () => {
  const s = replay([...open, { t: "NO_BALL" }, { t: "RUN", runs: 1 }], "CRICKET");
  assert.equal(s.freeHit, false);
});

test("a wide on a free hit leaves it standing", () => {
  const s = replay([...open, { t: "NO_BALL" }, { t: "WIDE" }], "CRICKET");
  assert.equal(s.freeHit, true, "the batter has not had their free hit yet");
});

test("a second no-ball re-arms it", () => {
  const s = replay([...open, { t: "NO_BALL" }, { t: "NO_BALL" }], "CRICKET");
  assert.equal(s.freeHit, true);
});

test("it survives the end of an over", () => {
  // Five legal balls, a no-ball on what would have been the sixth, then
  // the sixth. The over turns over with the free hit still to be taken.
  const s = replay(
    [
      ...open,
      ...Array.from({ length: 5 }, () => ({ t: "RUN", runs: 0 }) as ScoreEvent),
      { t: "NO_BALL" },
    ],
    "CRICKET",
  );
  assert.equal(s.ballsA, 5);
  assert.equal(s.freeHit, true, "the next bowler's first ball is a free hit");
});

test("the bowler is allowed nothing off the stumps", () => {
  const s = replay([...open, { t: "NO_BALL" }], "CRICKET");
  for (const kind of ["BOWLED", "CAUGHT", "LBW", "STUMPED", "HIT_WICKET"] as const) {
    assert.match(
      validateScoreEvent(s, { t: "WICKET", kind }, rules) ?? "",
      /free hit/i,
      `${kind} must be refused on a free hit`,
    );
  }
});

test("but a run out still stands", () => {
  const s = replay([...open, { t: "NO_BALL" }], "CRICKET");
  for (const kind of ["RUN_OUT", "OBSTRUCTING_FIELD", "HIT_BALL_TWICE"] as const) {
    assert.equal(
      validateScoreEvent(s, { t: "WICKET", kind, newBatter: "Chetan" }, rules),
      null,
      `${kind} is legal on a free hit`,
    );
  }
});

test("a no-ball on a free hit is not the free hit being taken", () => {
  // The batter is bowled off a second no-ball: still not out, and the
  // free hit rolls on rather than being consumed by the refusal.
  const s = replay([...open, { t: "NO_BALL" }], "CRICKET");
  assert.equal(
    validateScoreEvent(s, { t: "WICKET", kind: "RUN_OUT", delivery: "NO_BALL" }, rules),
    null,
  );
  const after = replay(
    [
      ...open,
      { t: "NO_BALL" },
      { t: "WICKET", kind: "RUN_OUT", delivery: "NO_BALL", newBatter: "Chetan" },
    ],
    "CRICKET",
  );
  assert.equal(after.freeHit, true, "re-armed by the second no-ball");
});

test("a new innings starts with no free hit owing", () => {
  const s = replay([...open, { t: "NO_BALL" }, { t: "END_INNINGS" }], "CRICKET");
  assert.equal(s.freeHit, false);
});
