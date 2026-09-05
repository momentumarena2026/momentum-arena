/**
 * Blocking court time on behalf of an event.
 *
 * The two pure pieces: expanding a recurring schedule into concrete
 * hours, and naming a block so a calendar cell says what holds it. Both
 * sit in front of real inventory — an off-by-one here withdraws a day
 * from sale that nobody asked to withdraw — so the arithmetic is pinned
 * rather than re-derived at each call site.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { expandWindows, blockLabel } from "../lib/slot-blocks";
import { newlyBlockedWindows } from "../lib/camp-blocks";
import { Sport } from "@prisma/client";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const key = (w: { date: Date; hour: number }) =>
  `${w.date.toISOString().slice(0, 10)}@${w.hour}`;

// 2026-09-07 is a Monday.
const MON = 1, WED = 3, SAT = 6;

test("a schedule expands to one entry per hour per matching day", () => {
  const w = expandWindows({
    startDate: d("2026-09-07"),
    endDate: d("2026-09-13"),
    daysOfWeek: [MON, WED],
    startHour: 16,
    endHour: 18,
  });
  // Two days in that week, two hours each.
  assert.equal(w.length, 4);
  assert.deepEqual(w.map(key), [
    "2026-09-07@16", "2026-09-07@17",
    "2026-09-09@16", "2026-09-09@17",
  ]);
});

test("endHour is exclusive", () => {
  // 16..18 is two hours. Treating it as three would block an hour past
  // the session and take it off sale for the life of the camp.
  const w = expandWindows({
    startDate: d("2026-09-07"),
    endDate: d("2026-09-07"),
    daysOfWeek: [MON],
    startHour: 16,
    endHour: 18,
  });
  assert.deepEqual(w.map((x) => x.hour), [16, 17]);
});

test("both end dates are inclusive", () => {
  // A camp running Mon-Mon meets on both Mondays. Dropping the last day
  // is the classic date-walk off-by-one.
  const w = expandWindows({
    startDate: d("2026-09-07"),
    endDate: d("2026-09-14"),
    daysOfWeek: [MON],
    startHour: 16,
    endHour: 17,
  });
  assert.deepEqual(w.map(key), ["2026-09-07@16", "2026-09-14@16"]);
});

test("a schedule that describes nothing blocks nothing", () => {
  const base = {
    startDate: d("2026-09-07"),
    endDate: d("2026-09-30"),
    daysOfWeek: [MON],
    startHour: 16,
    endHour: 18,
  };
  assert.deepEqual(expandWindows({ ...base, daysOfWeek: [] }), [], "no days");
  assert.deepEqual(expandWindows({ ...base, endHour: 16 }), [], "zero-length window");
  assert.deepEqual(expandWindows({ ...base, endHour: 15 }), [], "backwards window");
  assert.deepEqual(
    expandWindows({ ...base, endDate: d("2026-09-01") }),
    [],
    "ends before it starts",
  );
});

test("a weekday the range never reaches yields nothing", () => {
  const w = expandWindows({
    startDate: d("2026-09-07"),
    endDate: d("2026-09-11"),
    daysOfWeek: [SAT],
    startHour: 16,
    endHour: 17,
  });
  assert.deepEqual(w, []);
});

test("an absurd range is capped rather than expanded", () => {
  // A camp running for years is a data-entry mistake. Expanding it would
  // raise tens of thousands of rows before anybody noticed.
  const w = expandWindows({
    startDate: d("2026-01-01"),
    endDate: d("2036-01-01"),
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    startHour: 5,
    endHour: 24,
  });
  assert.ok(w.length <= 800 * 19, "guarded");
});

// ── extending a camp ───────────────────────────────────────────────

test("extending the end date reports only the NEW hours", () => {
  // This number is what the admin is shown before agreeing. Counting the
  // whole schedule instead would say "480 hours will be held" for a
  // one-week extension and teach them to ignore the warning.
  const before = {
    id: "c1", name: "Camp", sport: Sport.FOOTBALL, courtConfigId: null,
    startDate: d("2026-09-07"), endDate: d("2026-09-13"),
    daysOfWeek: [MON, WED], startHour: 16, endHour: 18,
  };
  const after = { ...before, endDate: d("2026-09-20") };
  assert.equal(newlyBlockedWindows(before, after), 4, "one more Mon + one more Wed, 2h each");
});

test("shrinking a camp adds nothing", () => {
  const before = {
    id: "c1", name: "Camp", sport: Sport.FOOTBALL, courtConfigId: null,
    startDate: d("2026-09-07"), endDate: d("2026-09-20"),
    daysOfWeek: [MON], startHour: 16, endHour: 18,
  };
  const after = { ...before, endDate: d("2026-09-13") };
  assert.equal(newlyBlockedWindows(before, after), 0, "nothing new is held");
});

test("widening the hours counts as newly blocked time", () => {
  // Not just the end date: adding an hour to every session withdraws
  // inventory just as surely as adding a week.
  const before = {
    id: "c1", name: "Camp", sport: Sport.CRICKET, courtConfigId: null,
    startDate: d("2026-09-07"), endDate: d("2026-09-13"),
    daysOfWeek: [MON, WED], startHour: 16, endHour: 18,
  };
  assert.equal(newlyBlockedWindows(before, { ...before, endHour: 19 }), 2);
  assert.equal(newlyBlockedWindows(before, { ...before, daysOfWeek: [MON, WED, SAT] }), 2);
});

// ── labels ─────────────────────────────────────────────────────────

test("a block says which event and which sport", () => {
  // "Tournament window" was the same six words on every block. An admin
  // looking at a blocked Tuesday could not tell which event owned it,
  // and so could not tell whether it was safe to move.
  assert.equal(
    blockLabel("TOURNAMENT", "Summer Cup", Sport.CRICKET),
    "Tournament: Summer Cup (cricket)",
  );
  assert.equal(
    blockLabel("CAMP", "Junior Academy", Sport.FOOTBALL),
    "Camp: Junior Academy (football)",
  );
});

test("a label survives a missing sport or name", () => {
  assert.equal(blockLabel("MANUAL", "Maintenance", null), "Blocked: Maintenance");
  assert.equal(blockLabel("TOURNAMENT", "", Sport.CRICKET), "Tournament (cricket)");
});
