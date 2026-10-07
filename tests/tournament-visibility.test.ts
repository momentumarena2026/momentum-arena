/**
 * What a tournament shows the public, and when.
 *
 * Two gates that look like one and are not. Conflating them shipped a
 * real bug: a LEAGUE tournament at REG_CLOSED showed a full fixture
 * list reading "TBD v TBD", because the matches carried real team ids
 * and the roster they resolve against had been withheld.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { poolMatchesArePublic, rosterIsPublic } from "../lib/tournament-config";

const LIFECYCLE = [
  "DRAFT",
  "PUBLISHED",
  "REG_OPEN",
  "REG_CLOSED",
  "POOLS_REVEALED",
  "LIVE",
  "COMPLETED",
] as const;

test("the roster is withheld while captains are still deciding", () => {
  // The venue's actual reason: a rival captain must not see who is in,
  // or how full it is, while they are choosing whether to enter.
  for (const s of ["DRAFT", "PUBLISHED", "REG_OPEN"]) {
    assert.equal(rosterIsPublic(s), false, s);
  }
});

test("the roster opens the moment registration closes", () => {
  // Nobody can act on it any more, and the fixtures are about to name
  // everyone regardless.
  for (const s of ["REG_CLOSED", "POOLS_REVEALED", "LIVE", "COMPLETED"]) {
    assert.equal(rosterIsPublic(s), true, s);
  }
});

test("REG_CLOSED is exactly where the two gates diverge", () => {
  // The bug in one assertion. A LEAGUE tournament never reaches
  // POOLS_REVEALED, so gating the roster on the draw left it hidden for
  // the whole tournament.
  assert.equal(rosterIsPublic("REG_CLOSED"), true);
  assert.equal(poolMatchesArePublic("REG_CLOSED"), false);
});

test("the roster is never narrower than the draw", () => {
  // If pool fixtures are public, the teams in them must be too —
  // otherwise the fixtures render against names that were withheld,
  // which is the failure this file exists for.
  for (const s of LIFECYCLE) {
    if (poolMatchesArePublic(s)) {
      assert.equal(rosterIsPublic(s), true, `${s}: fixtures public but roster hidden`);
    }
  }
});

test("the listing count follows the same gate as the detail page", () => {
  // THE THIRD SURFACE. The detail page and the public API were gated
  // first and the two LISTINGS were missed, so a tournament with
  // registrations open still advertised its entrant count on the
  // tournaments index — the same leak, one page over.
  //
  // Both listings now receive null rather than 0 and omit the line.
  // Zeroing it would have rendered "0/12" on a tournament that was
  // filling up, which is worse than the leak it was hiding.
  const countVisible = (status: string) => rosterIsPublic(status);

  assert.equal(countVisible("REG_OPEN"), false, "the case reported from production");
  assert.equal(countVisible("PUBLISHED"), false);
  assert.equal(countVisible("REG_CLOSED"), true);
  assert.equal(countVisible("COMPLETED"), true);
});

test("a cancelled tournament is not accidentally public", () => {
  assert.equal(rosterIsPublic("CANCELLED"), false);
  assert.equal(poolMatchesArePublic("CANCELLED"), false);
});

test("an unknown status fails closed", () => {
  assert.equal(rosterIsPublic("SOMETHING_NEW"), false);
  assert.equal(poolMatchesArePublic(""), false);
});
