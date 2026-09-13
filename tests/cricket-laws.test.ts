/**
 * The rest of the Laws: who owns a wicket, the rare dismissals, the two
 * kinds of retirement, runs that beat the bat off a no-ball, and penalty
 * runs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { replay, validateScoreEvent, type ScoreEvent } from "../lib/public-match";

const open: ScoreEvent[] = [
  { t: "SQUAD", side: "A", players: ["Amit", "Bala", "Chetan", "Dinesh"] },
  { t: "SQUAD", side: "B", players: ["Bowler"] },
  { t: "OPEN", striker: "Amit", nonStriker: "Bala", bowler: "Bowler" },
];

// ── Who the wicket belongs to ──────────────────────────────────────
test("only wickets taken off the stumps count for the bowler", () => {
  for (const kind of ["BOWLED", "CAUGHT", "LBW", "STUMPED", "HIT_WICKET"] as const) {
    const s = replay([...open, { t: "WICKET", kind, newBatter: "Chetan" }], "CRICKET");
    assert.equal(s.bowling["Bowler"].wickets, 1, `${kind} is the bowler's`);
  }
});

test("the rare four are never the bowler's", () => {
  // The live bug: these all fell into OTHER and paid the bowler for them.
  for (const kind of [
    "RUN_OUT",
    "OBSTRUCTING_FIELD",
    "HIT_BALL_TWICE",
    "TIMED_OUT",
    "RETIRED_OUT",
  ] as const) {
    const s = replay([...open, { t: "WICKET", kind, newBatter: "Chetan" }], "CRICKET");
    assert.equal(s.bowling["Bowler"].wickets, 0, `${kind} is not the bowler's`);
    assert.equal(s.wicketsA, 1, `${kind} still costs the side a wicket`);
  }
});

test("a wicket logged with no kind still counts for the bowler", () => {
  // The minimal web pad sends exactly this, and every match already played
  // has to keep replaying the way it was scored.
  const s = replay([...open, { t: "WICKET", newBatter: "Chetan" }], "CRICKET");
  assert.equal(s.bowling["Bowler"].wickets, 1);
});

// ── Retirement ─────────────────────────────────────────────────────
test("retiring hurt is not a dismissal and costs no wicket", () => {
  const s = replay([...open, { t: "RETIRE", batter: "Amit", newBatter: "Chetan" }], "CRICKET");
  assert.equal(s.wicketsA, 0, "the side has lost nobody");
  assert.equal(s.batting["Amit"].out, "RETIRED_HURT");
});

test("a batter who retired hurt can come back, keeping their runs", () => {
  const s = replay(
    [
      ...open,
      { t: "RUN", runs: 4 },
      { t: "RETIRE", batter: "Amit", newBatter: "Chetan" },
      { t: "WICKET", kind: "BOWLED", batter: "Chetan", newBatter: "Amit" },
    ],
    "CRICKET",
  );
  assert.equal(s.batting["Amit"].out, null, "not out again");
  assert.equal(s.batting["Amit"].runs, 4, "the four still stands");
  assert.equal(s.batting["Amit"].fours, 1);
  assert.equal(s.wicketsA, 1, "only Chetan's wicket");
});

test("retiring out is a wicket, but never the bowler's", () => {
  const s = replay(
    [...open, { t: "RETIRE", batter: "Amit", out: true, newBatter: "Chetan" }],
    "CRICKET",
  );
  assert.equal(s.wicketsA, 1);
  assert.equal(s.batting["Amit"].out, "RETIRED_OUT");
  assert.equal(s.bowling["Bowler"].wickets, 0);
});

test("a retirement costs no ball and leaves the ends alone", () => {
  const s = replay([...open, { t: "RETIRE", batter: "Bala", newBatter: "Chetan" }], "CRICKET");
  assert.equal(s.ballsA, 0);
  assert.equal(s.striker, "Amit");
  assert.equal(s.nonStriker, "Chetan");
});

// ── Runs that beat the bat off a no-ball ───────────────────────────
test("byes off a no-ball are extras, not the striker's runs", () => {
  const s = replay([...open, { t: "NO_BALL", byes: 2 }], "CRICKET");
  assert.equal(s.runsA, 3, "one penalty plus the two they ran");
  assert.equal(s.extras.noBall, 3, "all of it is no-ball extras");
  assert.equal(s.batting["Amit"].runs, 0, "the striker hit nothing");
  assert.equal(s.bowling["Bowler"].runs, 3, "the bowler concedes all of it");
  assert.equal(s.ballsA, 0, "and it is re-bowled");
});

test("a no-ball can carry runs off the bat and byes at once", () => {
  const s = replay([...open, { t: "NO_BALL", runs: 1, byes: 1 }], "CRICKET");
  assert.equal(s.runsA, 3);
  assert.equal(s.batting["Amit"].runs, 1, "only what came off the bat");
  assert.equal(s.extras.noBall, 2, "the penalty and the bye");
  // Two runs in total, so the batters are back where they started.
  assert.equal(s.striker, "Amit");
});

test("the batters cross on what they ran, off the bat or not", () => {
  const s = replay([...open, { t: "NO_BALL", byes: 1 }], "CRICKET");
  assert.equal(s.striker, "Bala", "one run means they changed ends");
});

// ── Penalty runs ───────────────────────────────────────────────────
test("penalty runs go to a side without costing a ball", () => {
  const s = replay([...open, { t: "PENALTY", side: "A", runs: 5 }], "CRICKET");
  assert.equal(s.runsA, 5);
  assert.equal(s.extras.penalty, 5);
  assert.equal(s.ballsA, 0);
  assert.equal(s.bowling["Bowler"].runs, 0, "they are nobody's to concede");
  assert.equal(s.striker, "Amit", "and nobody changes ends");
});

test("a penalty can be awarded against the batting side", () => {
  const s = replay([...open, { t: "PENALTY", side: "B", runs: 5 }], "CRICKET");
  assert.equal(s.runsA, 0);
  assert.equal(s.runsB, 5);
});

test("nonsense penalties are refused", () => {
  const s = replay(open, "CRICKET");
  const rules = { sport: "CRICKET" } as const;
  assert.match(
    validateScoreEvent(s, { t: "PENALTY", side: "A", runs: 0 }, rules) ?? "",
    /positive whole number/i,
  );
  assert.match(
    validateScoreEvent(s, { t: "PENALTY", side: "A", runs: 50 }, rules) ?? "",
    /more than any penalty/i,
  );
  assert.equal(validateScoreEvent(s, { t: "PENALTY", side: "A", runs: 5 }, rules), null);
});

// ── What each delivery can produce ─────────────────────────────────
test("a no-ball cannot produce a wicket off the stumps", () => {
  const s = replay(open, "CRICKET");
  const rules = { sport: "CRICKET" } as const;
  for (const kind of ["BOWLED", "CAUGHT", "LBW", "STUMPED", "HIT_WICKET"] as const) {
    assert.match(
      validateScoreEvent(s, { t: "WICKET", kind, delivery: "NO_BALL" }, rules) ?? "",
      /no-ball can only produce/i,
      `${kind} must be refused off a no-ball`,
    );
  }
  for (const kind of ["RUN_OUT", "OBSTRUCTING_FIELD", "HIT_BALL_TWICE"] as const) {
    assert.equal(
      validateScoreEvent(s, { t: "WICKET", kind, delivery: "NO_BALL" }, rules),
      null,
      `${kind} is legal off a no-ball`,
    );
  }
});

test("a wide can be stumped but never caught", () => {
  const s = replay(open, "CRICKET");
  const rules = { sport: "CRICKET" } as const;
  assert.equal(validateScoreEvent(s, { t: "WICKET", kind: "STUMPED", delivery: "WIDE" }, rules), null);
  assert.match(
    validateScoreEvent(s, { t: "WICKET", kind: "CAUGHT", delivery: "WIDE" }, rules) ?? "",
    /wide can only produce/i,
  );
});
