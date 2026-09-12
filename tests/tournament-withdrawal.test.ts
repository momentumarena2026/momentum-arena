/**
 * A team pulls out of a pool.
 *
 * The scenario this exists for: a pool of three, one team never turns up.
 * The two that did must end up with a real schedule between them — not a
 * single fixture deciding a qualifier on one afternoon — and whatever has
 * already been played must survive intact.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  poolLegs,
  roundRobinRounds,
  missingPoolPairings,
} from "../lib/tournament-fixtures";

const pairsOf = <T>(rounds: { pairs: [T, T][] }[]) => rounds.flatMap((r) => r.pairs);

test("a pool of two plays twice, a larger pool once", () => {
  assert.equal(poolLegs(2), 2);
  assert.equal(poolLegs(3), 1);
  assert.equal(poolLegs(4), 1);
});

test("two legs reverse the sides rather than repeat them", () => {
  // Neither team bats first twice.
  const rounds = roundRobinRounds(["a", "b"], 2);
  assert.deepEqual(pairsOf(rounds), [
    ["a", "b"],
    ["b", "a"],
  ]);
});

test("one leg is unchanged from a plain round robin", () => {
  const three = ["a", "b", "c"];
  assert.deepEqual(roundRobinRounds(three, 1), roundRobinRounds(three));
  assert.equal(pairsOf(roundRobinRounds(three)).length, 3);
});

test("round numbers stay consecutive across legs", () => {
  const rounds = roundRobinRounds(["a", "b", "c", "d"], 2);
  assert.deepEqual(
    rounds.map((r) => r.round),
    rounds.map((_, i) => i + 1),
  );
});

test("a pool of three losing a team is topped up to two legs", () => {
  // The whole scenario. Generated fixtures were a-b, a-c, b-c; c never
  // showed, so a-c and b-c are gone and only a-b survives.
  const missing = missingPoolPairings(["a", "b"], poolLegs(2), [
    { homeTeamId: "a", awayTeamId: "b" },
  ]);
  assert.equal(missing.length, 1, "one more leg is owed");
  // And the return fixture reverses the sides, since a was already home.
  assert.deepEqual(missing[0], ["b", "a"]);
});

test("a played match is counted, never recreated", () => {
  // Topping up must not duplicate the afternoon already played.
  const missing = missingPoolPairings(["a", "b"], 2, [
    { homeTeamId: "a", awayTeamId: "b" },
    { homeTeamId: "b", awayTeamId: "a" },
  ]);
  assert.deepEqual(missing, []);
});

test("fixtures against the departed team don't count towards the pool", () => {
  // a-c and b-c are exactly what is being replaced; if they counted, the
  // pool would think it owed nothing and the two survivors would never be
  // given a match.
  const missing = missingPoolPairings(["a", "b"], 2, [
    { homeTeamId: "a", awayTeamId: "c" },
    { homeTeamId: "b", awayTeamId: "c" },
  ]);
  assert.equal(missing.length, 2);
  assert.deepEqual(missing.map((p) => p.slice().sort()), [
    ["a", "b"],
    ["a", "b"],
  ]);
  // Balanced: one each, not both to the same side.
  assert.notDeepEqual(missing[0], missing[1]);
});

test("an unfilled side is ignored rather than paired", () => {
  // A knockout placeholder ("Winner Pool A") has no team yet.
  const missing = missingPoolPairings(["a", "b"], 1, [
    { homeTeamId: "a", awayTeamId: null },
    { homeTeamId: null, awayTeamId: null },
  ]);
  assert.deepEqual(missing, [["a", "b"]]);
});

test("a pool of three from scratch owes three matches", () => {
  const missing = missingPoolPairings(["a", "b", "c"], poolLegs(3), []);
  assert.equal(missing.length, 3);
  // Every pair exactly once.
  const keys = new Set(missing.map((p) => p.slice().sort().join("|")));
  assert.equal(keys.size, 3);
});

test("home games are spread when a pool is built from nothing", () => {
  const missing = missingPoolPairings(["a", "b", "c"], 1, []);
  const homes = new Map<string, number>();
  for (const [h] of missing) homes.set(h, (homes.get(h) ?? 0) + 1);
  // Three teams, three matches: nobody should be home all three times.
  assert.ok(Math.max(...homes.values()) <= 2, "home games are spread");
});
