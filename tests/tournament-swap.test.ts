/**
 * Swapping two fixtures' slots.
 *
 * Two captains agree between themselves to exchange a morning and an
 * evening, and the organiser records it. What is worth pinning down is
 * WHEN that must be refused — the eligibility rules are the whole safety
 * argument for a write that skips the clash checks scheduling does.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { swapBlocker, type SwapCandidate } from "../lib/tournament-fixtures";

const base: SwapCandidate = {
  id: "m1",
  tournamentId: "t1",
  roundLabel: "Pool A · Match 1",
  status: "SCHEDULED",
  courtConfigId: "court-1",
  scheduledAt: new Date("2026-09-20T01:30:00.000Z"), // 7:00 IST
  homeScore: null,
  awayScore: null,
};
const other: SwapCandidate = {
  ...base,
  id: "m2",
  roundLabel: "Pool A · Match 2",
  courtConfigId: "court-2",
  scheduledAt: new Date("2026-09-20T13:30:00.000Z"), // 19:00 IST
};

test("two scheduled fixtures in the same tournament can swap", () => {
  assert.equal(swapBlocker(base, other), null);
});

test("a fixture cannot swap with itself", () => {
  assert.match(swapBlocker(base, { ...other, id: "m1" }) ?? "", /different/i);
});

test("fixtures from different tournaments cannot swap", () => {
  // Would move one event's held hours onto another event's calendar, with
  // the block's sourceId then naming the wrong owner.
  assert.match(
    swapBlocker(base, { ...other, tournamentId: "t2" }) ?? "",
    /same tournament/i,
  );
});

test("an unscheduled fixture cannot swap", () => {
  // There is no window to give, so the other side would be left holding
  // nothing while its own hours were released.
  assert.match(
    swapBlocker(base, { ...other, scheduledAt: null }) ?? "",
    /schedule them first/i,
  );
  assert.match(
    swapBlocker(base, { ...other, courtConfigId: null }) ?? "",
    /schedule them first/i,
  );
});

test("a live, completed or walkover fixture cannot be moved", () => {
  for (const status of ["LIVE", "COMPLETED", "WALKOVER"]) {
    const blocked = swapBlocker(base, { ...other, status });
    assert.ok(blocked, `${status} should block the swap`);
    assert.match(blocked, new RegExp(status.toLowerCase()));
    // Named, so the organiser knows which of the two is the problem.
    assert.match(blocked, /Match 2/);
  }
});

test("a cancelled fixture may still be moved", () => {
  // Cancelled is not played — its hours are not spent, and organisers do
  // reinstate matches. Nothing about it makes an exchange incoherent.
  assert.equal(swapBlocker(base, { ...other, status: "CANCELLED" }), null);
});

test("a fixture carrying a score cannot be moved", () => {
  // Catches the case a status alone misses: a result typed in while the
  // row still reads SCHEDULED.
  assert.match(swapBlocker(base, { ...other, homeScore: 3 }) ?? "", /score/i);
  assert.match(swapBlocker({ ...base, awayScore: 0 }, other) ?? "", /score/i);
});

test("either order gives the same answer", () => {
  const bad = { ...other, status: "LIVE" };
  assert.equal(swapBlocker(base, bad), swapBlocker(bad, base));
});
