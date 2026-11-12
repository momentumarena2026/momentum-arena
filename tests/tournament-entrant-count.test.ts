/**
 * Who may see how full a draw is.
 *
 * The venue's standing rule is that the registered-team count stays
 * hidden while registration is open: a public figure on a 12-team draw
 * is a running scoreboard of how badly it is selling, and "11 spots
 * left" is an argument against entering. That rule is still the
 * default. What is new is that an organiser can waive it for ONE
 * tournament — a draw filling well wants the scarcity on display.
 *
 * The split these tests protect: the COUNT and the entrant LIST are now
 * two questions. Showing "10/12 entered" gives away nothing about WHO
 * is in, and the names stay shut until registration closes either way.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  entrantCountIsPublic,
  rosterIsPublic,
  ROSTER_PUBLIC_STATUSES,
} from "../lib/tournament-config";

const DURING_REGISTRATION = ["DRAFT", "PUBLISHED", "REG_OPEN"];

test("by default the count is withheld while registration is open", () => {
  for (const status of DURING_REGISTRATION) {
    assert.equal(
      entrantCountIsPublic(status, false),
      false,
      `${status} must hide the count unless the organiser opts in`,
    );
  }
});

test("the organiser can opt one tournament in", () => {
  for (const status of DURING_REGISTRATION) {
    assert.equal(
      entrantCountIsPublic(status, true),
      true,
      `${status} must show the count when showEntrantCount is set`,
    );
  }
});

test("once registration closes the count is public either way", () => {
  // Nothing left to withhold — the fixtures are about to name everyone.
  for (const status of ROSTER_PUBLIC_STATUSES) {
    assert.equal(entrantCountIsPublic(status, false), true, `${status} with the toggle off`);
    assert.equal(entrantCountIsPublic(status, true), true, `${status} with the toggle on`);
  }
});

test("an unset flag behaves exactly as off — no accidental reveal", () => {
  // Rows written before the column existed read back null/undefined.
  // Defaulting those to "show" would publish the count for every
  // tournament already running.
  for (const status of DURING_REGISTRATION) {
    assert.equal(entrantCountIsPublic(status, null), false, `${status} with null`);
    assert.equal(entrantCountIsPublic(status, undefined), false, `${status} with undefined`);
  }
});

test("opting into the COUNT never opens the entrant LIST", () => {
  // The whole point of splitting the gates. If this ever becomes true,
  // an organiser advertising "10/12 entered" has also handed rival
  // captains the field they are up against.
  for (const status of DURING_REGISTRATION) {
    assert.equal(
      rosterIsPublic(status),
      false,
      `${status}: names must stay hidden regardless of the count toggle`,
    );
  }
});
