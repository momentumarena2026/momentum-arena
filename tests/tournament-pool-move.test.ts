/**
 * Moving a team between pools after the reveal.
 *
 * The reveal used to lock pools outright, which was backwards: the reveal
 * is exactly when captains see the draw and start asking for changes.
 * What actually cannot be undone is a PLAYED match, because points are
 * computed per pool.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { poolMoveBlocker, type PlayedCheck } from "../lib/tournament-fixtures";

const unplayed: PlayedCheck[] = [
  { status: "SCHEDULED", homeScore: null, awayScore: null },
  { status: "CANCELLED", homeScore: null, awayScore: null },
];

test("a team with no played match can move once pools are revealed", () => {
  // The whole point of the change: this used to be refused.
  assert.equal(poolMoveBlocker("POOLS_REVEALED", unplayed), null);
});

test("moves stay open before the reveal", () => {
  assert.equal(poolMoveBlocker("REG_OPEN", []), null);
  assert.equal(poolMoveBlocker("REG_CLOSED", unplayed), null);
});

test("a team that hasn't played can still move mid-tournament", () => {
  // Pool A can be underway while Pool D has not started, and Pool D's
  // captains have as much right to ask as anyone. The limit is per team,
  // not per tournament.
  assert.equal(poolMoveBlocker("LIVE", unplayed), null);
});

test("a team that has played cannot move", () => {
  for (const status of ["LIVE", "COMPLETED", "WALKOVER"]) {
    const blocked = poolMoveBlocker("POOLS_REVEALED", [
      ...unplayed,
      { status, homeScore: null, awayScore: null },
    ]);
    assert.match(blocked ?? "", /already played/i);
  }
});

test("a score blocks the move even when the status says otherwise", () => {
  // Catches a result typed in against a row still reading SCHEDULED —
  // its points are already in the table.
  assert.match(
    poolMoveBlocker("POOLS_REVEALED", [
      { status: "SCHEDULED", homeScore: 4, awayScore: null },
    ]) ?? "",
    /already played/i,
  );
  assert.match(
    poolMoveBlocker("LIVE", [{ status: "SCHEDULED", homeScore: null, awayScore: 0 }]) ?? "",
    /already played/i,
  );
});

test("a finished or cancelled tournament is closed to moves", () => {
  assert.match(poolMoveBlocker("COMPLETED", []) ?? "", /finished/i);
  assert.match(poolMoveBlocker("CANCELLED", []) ?? "", /cancelled/i);
});

test("pools cannot be arranged before they are dealt", () => {
  assert.match(poolMoveBlocker("DRAFT", []) ?? "", /deal the pools/i);
  assert.match(poolMoveBlocker("PUBLISHED", []) ?? "", /deal the pools/i);
});
