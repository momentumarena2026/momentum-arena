/**
 * "Match N" must count upwards in the order fixtures are listed.
 *
 * The number is the only thing an organiser calls a fixture by — over the
 * PA, on a printed sheet, to a captain — so a list where it does not
 * count upwards is worse than one with no numbers at all. Reported from
 * the admin Fixtures tab, which after a drag read:
 *
 *   Pool A · Match 2   6:00 am
 *   Pool A · Match 1   7:00 am
 *   Pool A · Match 3   8:00 am
 */
import test from "node:test";
import assert from "node:assert/strict";

import { renumberedLabels } from "../lib/tournament-fixtures";

const pool = (id: string, label: string, poolName: string | null = "Pool A") => ({
  id,
  roundLabel: label,
  poolName,
});

test("a dragged pool is renumbered in list order", () => {
  const out = renumberedLabels([
    pool("a", "Pool A · Match 2"),
    pool("b", "Pool A · Match 1"),
    pool("c", "Pool A · Match 3"),
  ]);
  assert.deepEqual(out, [
    { id: "a", roundLabel: "Pool A · Match 1" },
    { id: "b", roundLabel: "Pool A · Match 2" },
  ]);
  // "c" is already Match 3 and is deliberately absent — a no-op write per
  // fixture on every delete adds up on a 40-match draw.
});

test("an already-correct list produces no writes at all", () => {
  const out = renumberedLabels([
    pool("a", "Pool A · Match 1"),
    pool("b", "Pool A · Match 2"),
    pool("c", "Pool A · Match 3"),
  ]);
  assert.deepEqual(out, []);
});

test("deleting the middle fixture closes the gap", () => {
  // Match 2 is gone; Match 3 must become Match 2 rather than leaving
  // "Match 1, Match 3" on a printed sheet.
  const out = renumberedLabels([
    pool("a", "Pool A · Match 1"),
    pool("c", "Pool A · Match 3"),
  ]);
  assert.deepEqual(out, [{ id: "c", roundLabel: "Pool A · Match 2" }]);
});

test("each pool counts from 1, however the pools interleave", () => {
  // Pool matches from different pools interleave in the list because it
  // is ordered by play order. Numbering across the whole stage would
  // produce "Pool B · Match 4" in a pool that has two.
  const out = renumberedLabels([
    pool("a1", "Pool A · Match 9", "Pool A"),
    pool("b1", "Pool B · Match 9", "Pool B"),
    pool("a2", "Pool A · Match 9", "Pool A"),
    pool("b2", "Pool B · Match 9", "Pool B"),
  ]);
  assert.deepEqual(out, [
    { id: "a1", roundLabel: "Pool A · Match 1" },
    { id: "b1", roundLabel: "Pool B · Match 1" },
    { id: "a2", roundLabel: "Pool A · Match 2" },
    { id: "b2", roundLabel: "Pool B · Match 2" },
  ]);
});

test("knockout rounds keep their names", () => {
  // "Semi Final 1" and "Final" are positional already. Renumbering them
  // to "Match 1" would destroy the only thing that says what they are.
  const out = renumberedLabels([
    { id: "s1", roundLabel: "Semi Final 1", poolName: null },
    { id: "s2", roundLabel: "Semi Final 2", poolName: null },
    { id: "f", roundLabel: "Final", poolName: null },
    { id: "t", roundLabel: "3rd Place", poolName: null },
  ]);
  assert.deepEqual(out, []);
});

test("a league stage numbers without a pool prefix", () => {
  const out = renumberedLabels([
    { id: "a", roundLabel: "Match 3", poolName: null },
    { id: "b", roundLabel: "Match 1", poolName: null },
  ]);
  assert.deepEqual(out, [
    { id: "a", roundLabel: "Match 1" },
    { id: "b", roundLabel: "Match 2" },
  ]);
});

test("a knockout round mixed into the list is skipped, not counted", () => {
  // The skipped row must not consume a number, or the pool fixtures
  // after it would start from 2.
  const out = renumberedLabels([
    { id: "f", roundLabel: "Final", poolName: null },
    pool("a", "Pool A · Match 5"),
    pool("b", "Pool A · Match 6"),
  ]);
  assert.deepEqual(out, [
    { id: "a", roundLabel: "Pool A · Match 1" },
    { id: "b", roundLabel: "Pool A · Match 2" },
  ]);
});

test("an unlabelled or oddly-labelled fixture is left alone", () => {
  const out = renumberedLabels([
    { id: "x", roundLabel: null, poolName: "Pool A" },
    { id: "y", roundLabel: "Rematch", poolName: "Pool A" },
    { id: "z", roundLabel: "Match 2 (replay)", poolName: "Pool A" },
  ]);
  assert.deepEqual(out, [], "only a bare trailing 'Match N' is ours to rewrite");
});

test("a hand-typed pool label is renumbered like a generated one", () => {
  // "Pool A Match 1" and "Pool A · Match 1" say the same thing. Only the
  // second used to be recognised, so a fixture adopted into a pool kept
  // its typed number while the pool renumbered around it — leaving two
  // rows both reading Match 1.
  const out = renumberedLabels([
    { id: "a", roundLabel: "Pool A Match 1", poolName: "Pool A" },
    { id: "b", roundLabel: "Pool A · Match 1", poolName: "Pool A" },
  ]);
  assert.deepEqual(out, [
    { id: "a", roundLabel: "Pool A · Match 1" },
    { id: "b", roundLabel: "Pool A · Match 2" },
  ]);
});

test("knockout names still survive a pool name that prefixes them", () => {
  const out = renumberedLabels([
    { id: "a", roundLabel: "Semi Final 1", poolName: null },
    { id: "b", roundLabel: "Final", poolName: null },
    { id: "c", roundLabel: "Pool A Quarter Final 2", poolName: "Pool A" },
  ]);
  assert.deepEqual(out, []);
});
