/**
 * Which end a run out leaves the batters at.
 *
 * One rule decides it: the incoming batter takes the end the DISMISSAL
 * happened at, and the survivor takes the other. Every other dismissal
 * takes the batter at their own end, so the end is implied — a run out is
 * the only one where the striker can be out at the far end, having
 * crossed.
 *
 * The engine used to resolve from the dismissed batter's own end, which
 * put the new batter on strike after a striker was run out at the
 * non-striker's end. The wrong man faced the next ball.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { replay, type ScoreEvent } from "../lib/public-match";

const open: ScoreEvent[] = [
  { t: "SQUAD", side: "A", players: ["Amit", "Bala", "Chetan"] },
  { t: "SQUAD", side: "B", players: ["Dev"] },
  { t: "OPEN", striker: "Amit", nonStriker: "Bala", bowler: "Dev" },
];

/** Ends after the given wicket, from a fresh over. */
function ends(w: Partial<Extract<ScoreEvent, { t: "WICKET" }>>) {
  const s = replay(
    [...open, { t: "WICKET", kind: "RUN_OUT", newBatter: "Chetan", ...w }],
    "CRICKET",
  );
  return { striker: s.striker, nonStriker: s.nonStriker };
}

test("striker run out at the striker's end — new batter is on strike", () => {
  // Never crossed, or was sent back. Nothing about the ends changes.
  assert.deepEqual(ends({ outAtEnd: "STRIKER" }), {
    striker: "Chetan",
    nonStriker: "Bala",
  });
});

test("striker run out at the NON-striker's end — the survivor keeps strike", () => {
  // The case this was built for. To be out down there they must have
  // crossed, so Bala is now at the striker's end and faces next; Chetan
  // walks in to the end Amit was dismissed at.
  assert.deepEqual(ends({ outAtEnd: "NON_STRIKER" }), {
    striker: "Bala",
    nonStriker: "Chetan",
  });
});

test("non-striker run out at the non-striker's end — striker keeps strike", () => {
  assert.deepEqual(ends({ batter: "Bala", outAtEnd: "NON_STRIKER" }), {
    striker: "Amit",
    nonStriker: "Chetan",
  });
});

test("non-striker run out at the striker's end — new batter is on strike", () => {
  // They crossed, so Amit is down at the far end now.
  assert.deepEqual(ends({ batter: "Bala", outAtEnd: "STRIKER" }), {
    striker: "Chetan",
    nonStriker: "Amit",
  });
});

test("omitting the end keeps the old meaning, so logged matches replay unchanged", () => {
  // Every WICKET event written before this field existed meant "their own
  // end", and must keep meaning that.
  assert.deepEqual(ends({}), { striker: "Chetan", nonStriker: "Bala" });
  assert.deepEqual(ends({ batter: "Bala" }), { striker: "Amit", nonStriker: "Chetan" });
});

test("completed runs count to the batter who faced the ball, not the one out", () => {
  // Out going for the second. Bala is run out; the single Amit hit is
  // still Amit's run.
  const s = replay(
    [
      ...open,
      {
        t: "WICKET",
        kind: "RUN_OUT",
        batter: "Bala",
        outAtEnd: "STRIKER",
        runs: 1,
        newBatter: "Chetan",
      },
    ],
    "CRICKET",
  );
  assert.equal(s.runsA, 1, "the run stands");
  assert.equal(s.batting["Amit"].runs, 1, "credited to the striker");
  assert.equal(s.batting["Bala"].runs, 0, "not to the batter who was out");
  assert.equal(s.wicketsA, 1);
});

test("the delivery is faced by the striker even when the non-striker goes", () => {
  const s = replay(
    [...open, { t: "WICKET", kind: "RUN_OUT", batter: "Bala", newBatter: "Chetan" }],
    "CRICKET",
  );
  assert.equal(s.batting["Amit"].balls, 1, "the striker faced it");
  assert.equal(s.batting["Bala"].balls, 0, "the non-striker did not");
  assert.equal(s.ballsA, 1);
});

test("a run out is not credited to the bowler", () => {
  const s = replay(
    [...open, { t: "WICKET", kind: "RUN_OUT", newBatter: "Chetan" }],
    "CRICKET",
  );
  assert.equal(s.bowling["Dev"].wickets, 0);
  const caught = replay(
    [...open, { t: "WICKET", kind: "CAUGHT", newBatter: "Chetan" }],
    "CRICKET",
  );
  assert.equal(caught.bowling["Dev"].wickets, 1);
});

test("on the last ball of the over the ends still turn over afterwards", () => {
  // Five balls, then a run out at the striker's end. Chetan replaces Amit
  // there — and then the over ends, so Bala faces the next one. A new
  // batter does not take strike at the end of an over.
  const s = replay(
    [
      ...open,
      { t: "RUN", runs: 0 },
      { t: "RUN", runs: 0 },
      { t: "RUN", runs: 0 },
      { t: "RUN", runs: 0 },
      { t: "RUN", runs: 0 },
      { t: "WICKET", kind: "RUN_OUT", outAtEnd: "STRIKER", newBatter: "Chetan" },
    ],
    "CRICKET",
  );
  assert.equal(s.ballsA, 6);
  assert.deepEqual({ striker: s.striker, nonStriker: s.nonStriker }, {
    striker: "Bala",
    nonStriker: "Chetan",
  });
});

test("a caught batter still takes strike — MCC Law 18.11, 2022", () => {
  // Changed 1 Oct 2022: the new batter faces regardless of whether the
  // batters crossed. Asserted so a later refactor can't quietly revert it.
  const s = replay(
    [...open, { t: "WICKET", kind: "CAUGHT", newBatter: "Chetan" }],
    "CRICKET",
  );
  assert.equal(s.striker, "Chetan");
  assert.equal(s.nonStriker, "Bala");
});

/**
 * Mankad — the non-striker run out backing up, before the ball is
 * delivered. Legal since the 2022 code moved it from Unfair Play into
 * Run out.
 *
 * The whole difficulty is that no delivery happened: it is not a ball in
 * the over, nobody faced it, and nothing was scored off it.
 */
test("a Mankad costs no ball in the over", () => {
  const s = replay(
    [
      ...open,
      { t: "RUN", runs: 1 }, // ends swap, so Bala is on strike, Amit backing up
      {
        t: "WICKET",
        kind: "RUN_OUT",
        batter: "Amit",
        outAtEnd: "NON_STRIKER",
        beforeDelivery: true,
        newBatter: "Chetan",
      },
    ],
    "CRICKET",
  );
  assert.equal(s.ballsA, 1, "still one ball bowled in this over");
  assert.equal(s.wicketsA, 1);
});

test("nobody is charged a ball they never faced", () => {
  const s = replay(
    [
      ...open,
      {
        t: "WICKET",
        kind: "RUN_OUT",
        batter: "Bala",
        outAtEnd: "NON_STRIKER",
        beforeDelivery: true,
        newBatter: "Chetan",
      },
    ],
    "CRICKET",
  );
  assert.equal(s.batting["Amit"].balls, 0, "the striker never faced it");
  assert.equal(s.batting["Bala"].balls, 0);
  assert.equal(s.bowling["Dev"].balls, 0, "and it is not the bowler's ball either");
});

test("a Mankad leaves the striker on strike", () => {
  // Dismissed at the non-striker's end, so the new batter fills that end
  // and the striker is still to face.
  const s = replay(
    [
      ...open,
      {
        t: "WICKET",
        kind: "RUN_OUT",
        batter: "Bala",
        outAtEnd: "NON_STRIKER",
        beforeDelivery: true,
        newBatter: "Chetan",
      },
    ],
    "CRICKET",
  );
  assert.equal(s.striker, "Amit");
  assert.equal(s.nonStriker, "Chetan");
});

test("a Mankad on what would have been the last ball doesn't end the over", () => {
  // Five balls gone. A Mankad consumes none, so the over still owes one.
  const s = replay(
    [
      ...open,
      ...Array.from({ length: 5 }, () => ({ t: "RUN", runs: 0 }) as ScoreEvent),
      {
        t: "WICKET",
        kind: "RUN_OUT",
        batter: "Bala",
        outAtEnd: "NON_STRIKER",
        beforeDelivery: true,
        newBatter: "Chetan",
      },
    ],
    "CRICKET",
  );
  assert.equal(s.ballsA, 5, "the over is not complete");
  assert.equal(s.bowler, "Dev", "so the scorer isn't asked for a new bowler");
  assert.equal(s.striker, "Amit", "and the ends have not turned over");
});
