/**
 * The tournament registration drive.
 *
 * This is the only push in the product that is designed to repeat to
 * the same person day after day, so the tests that matter are not about
 * whether it sends. They are about whether it STOPS.
 *
 * Four things must each be able to stop it on their own — the draw
 * filling, registration closing, the status moving on, and the admin
 * switch — and one more must stop it for an individual: having already
 * entered. A drive that keeps asking a captain who registered on day
 * one is the fastest way to turn a tournament promo into an uninstall.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  driveRefusal,
  driveSuppression,
  driveVars,
  pickDriveLine,
  renderDriveCopy,
  driveSettingsRefusal,
  type DriveTournamentFacts,
  type DriveLimits,
  type DriveLine,
} from "../lib/tournament-reg-drive";

// 19:00 IST = 13:30 UTC, which is the default send hour.
const AT_SEND_HOUR = new Date("2026-10-12T13:30:00.000Z");

const facts = (over: Partial<DriveTournamentFacts> = {}): DriveTournamentFacts => ({
  status: "REG_OPEN",
  regDriveEnabled: true,
  regDriveHourIST: 19,
  regCloseAt: new Date("2026-10-21T06:10:00.000Z"),
  totalTeams: 12,
  confirmedTeams: 4,
  pendingTeams: 0,
  enabledLines: 8,
  ...over,
});

const limits: DriveLimits = {
  maxPushesPerDay: 2,
  maxConsecutiveDays: 3,
  quietFromHour: 22,
  quietToHour: 8,
};

// ── Stopping ───────────────────────────────────────────────────────────

test("it runs when the tournament is open, not full, and it is the hour", () => {
  assert.equal(driveRefusal(facts(), AT_SEND_HOUR), null);
});

test("a full draw stops it — this is what 'until registration completes' means", () => {
  assert.match(
    driveRefusal(facts({ confirmedTeams: 12 }), AT_SEND_HOUR) ?? "",
    /draw is full \(12\/12 confirmed\)/,
  );
  // Over-subscribed (a waitlist conversion, a manual add) must also stop.
  assert.match(driveRefusal(facts({ confirmedTeams: 13 }), AT_SEND_HOUR) ?? "", /draw is full/);
});

test("UNPAID teams do not count as filled spots", () => {
  // The rule worth arguing about. If PENDING_PAYMENT counted, eight
  // abandoned checkouts would switch off the drive for a tournament
  // with four real teams in it — and the drive is exactly what would
  // have rescued it.
  assert.equal(
    driveRefusal(facts({ confirmedTeams: 4, pendingTeams: 8 }), AT_SEND_HOUR),
    null,
    "4 confirmed + 8 unpaid is not a full draw",
  );
});

test("the close date stops it, inclusive of the instant itself", () => {
  const closesAt = new Date("2026-10-21T06:10:00.000Z");
  const after = new Date(closesAt.getTime());
  // Move to the send hour on a day past the close.
  assert.match(
    driveRefusal(facts({ regCloseAt: closesAt }), new Date("2026-10-22T13:30:00.000Z")) ?? "",
    /registration has closed/,
  );
  assert.match(driveRefusal(facts({ regCloseAt: after }), after) ?? "", /closed|send hour/);
});

test("an open-ended tournament is not stopped by a missing close date", () => {
  // regCloseAt is nullable. Reading null as "closed" would silently
  // disable the drive on exactly the tournaments that need it most.
  assert.equal(driveRefusal(facts({ regCloseAt: null }), AT_SEND_HOUR), null);
});

test("every status other than REG_OPEN stops it", () => {
  for (const status of ["DRAFT", "PUBLISHED", "REG_CLOSED", "POOLS_REVEALED", "LIVE", "COMPLETED", "CANCELLED"]) {
    assert.match(
      driveRefusal(facts({ status }), AT_SEND_HOUR) ?? "",
      /registration is not open/,
      status,
    );
  }
  // PUBLISHED especially: registration has not opened, so driving
  // people to a page that cannot take their entry is worse than silence.
  assert.match(driveRefusal(facts({ status: "PUBLISHED" }), AT_SEND_HOUR) ?? "", /not open/);
});

test("the admin switch stops it, and says so first", () => {
  // Above everything else, so an admin who switched it off reads
  // "switched off" rather than "not the send hour".
  assert.match(
    driveRefusal(facts({ regDriveEnabled: false, status: "COMPLETED" }), AT_SEND_HOUR) ?? "",
    /switched off/,
  );
});

test("a drive with no enabled copy refuses rather than claiming an audience", () => {
  assert.match(driveRefusal(facts({ enabledLines: 0 }), AT_SEND_HOUR) ?? "", /every line.*switched off/);
});

test("it only sends on its own hour", () => {
  const elevenIST = new Date("2026-10-12T05:30:00.000Z");
  assert.match(driveRefusal(facts(), elevenIST) ?? "", /not the send hour \(now 11:00 IST, set to 19:00\)/);
});

// ── Who gets it ────────────────────────────────────────────────────────

const cand = (over = {}) => ({
  optedOut: false,
  alreadyEntered: false,
  alreadySentToday: false,
  pushesToday: 0,
  consecutiveDays: 0,
  ...over,
});

test("somebody who already entered is never asked to enter", () => {
  // The whole point of targeting it. Ranked above the caps so a dry run
  // reports the real reason.
  assert.match(driveSuppression(cand({ alreadyEntered: true }), limits) ?? "", /already has a team/);
});

test("an opt-out is honoured", () => {
  assert.match(driveSuppression(cand({ optedOut: true }), limits) ?? "", /opted out/);
});

test("nobody is asked twice in a day", () => {
  assert.match(driveSuppression(cand({ alreadySentToday: true }), limits) ?? "", /already sent today/);
});

test("the streak cap stops an unbounded sequence of identical asks", () => {
  // "Daily until it fills" against a tournament that never fills is an
  // infinite nudge. Rotating the copy does not fix that: varying how
  // you ask does not change that it is the tenth time.
  assert.equal(driveSuppression(cand({ consecutiveDays: 2 }), limits), null);
  assert.match(driveSuppression(cand({ consecutiveDays: 3 }), limits) ?? "", /3 days running/);
  // 0 disables the check, for a flagship event the venue wants pushed hard.
  assert.equal(
    driveSuppression(cand({ consecutiveDays: 99 }), { ...limits, maxConsecutiveDays: 0 }),
    null,
  );
});

test("the shared daily ceiling is respected, so two modules cannot each send two", () => {
  assert.equal(driveSuppression(cand({ pushesToday: 1 }), limits), null);
  assert.match(driveSuppression(cand({ pushesToday: 2 }), limits) ?? "", /already had 2 pushes today/);
});

test("an ordinary customer with no history gets it", () => {
  assert.equal(driveSuppression(cand(), limits), null);
});

// ── The words ──────────────────────────────────────────────────────────

const tourney = {
  name: "Momentum October Cup",
  totalTeams: 12,
  confirmedTeams: 4,
  regCloseAt: new Date("2026-10-21T06:10:00.000Z"),
  prizePool: 6100,
  entryFee: 3000,
};

test("the numbers in the copy are the real ones", () => {
  const v = driveVars(tourney, AT_SEND_HOUR);
  assert.equal(v.spotsLeft, "8");
  assert.equal(v.prizePool, "₹6,100");
  assert.equal(v.entryFee, "₹3,000");
});

test("spots left never goes negative", () => {
  // An over-subscribed draw would otherwise advertise "-1 spots left".
  assert.equal(driveVars({ ...tourney, confirmedTeams: 14 }, AT_SEND_HOUR).spotsLeft, "0");
});

test("days left is ceilinged, so a deadline tonight is not '0 days'", () => {
  const closesIn11h = new Date(AT_SEND_HOUR.getTime() + 11 * 3600_000);
  assert.equal(driveVars({ ...tourney, regCloseAt: closesIn11h }, AT_SEND_HOUR).daysLeft, "1");
});

test("an open-ended tournament renders no day count rather than a broken one", () => {
  assert.equal(driveVars({ ...tourney, regCloseAt: null }, AT_SEND_HOUR).daysLeft, "");
});

test("a free tournament says 'free', not '₹0'", () => {
  assert.equal(driveVars({ ...tourney, entryFee: 0 }, AT_SEND_HOUR).entryFee, "free");
});

test("no prize pool renders empty, so the copy can omit it cleanly", () => {
  assert.equal(driveVars({ ...tourney, prizePool: null }, AT_SEND_HOUR).prizePool, "");
  assert.equal(driveVars({ ...tourney, prizePool: 0 }, AT_SEND_HOUR).prizePool, "");
});

test("placeholders are filled, and an unknown one is left visible", () => {
  const v = driveVars(tourney, AT_SEND_HOUR);
  assert.equal(renderDriveCopy("{spotsLeft} spots in {name}", v), "8 spots in Momentum October Cup");
  // Left in place rather than blanked: a typo in admin-authored copy
  // should be obvious, not silently produce "Only  spots left".
  assert.equal(renderDriveCopy("{spotsleft} left", v), "{spotsleft} left");
});

// ── Rotation ───────────────────────────────────────────────────────────

const line = (id: string, sentAt: Date | null, enabled = true): DriveLine => ({
  id,
  title: id,
  body: null,
  enabled,
  sentAt,
});

test("never-used copy goes out before anything repeats", () => {
  const picked = pickDriveLine([
    line("a", new Date("2026-10-01T00:00:00Z")),
    line("b", null),
  ]);
  assert.equal(picked?.id, "b");
});

test("then least-recently-used, so the pool cycles instead of shuffling", () => {
  const picked = pickDriveLine([
    line("a", new Date("2026-10-05T00:00:00Z")),
    line("b", new Date("2026-10-02T00:00:00Z")),
    line("c", new Date("2026-10-09T00:00:00Z")),
  ]);
  assert.equal(picked?.id, "b");
});

test("a switched-off line is never picked", () => {
  assert.equal(pickDriveLine([line("a", null, false)]), null);
  assert.equal(pickDriveLine([line("a", null, false), line("b", new Date())])?.id, "b");
});

test("eight lines cycle without repeating before all have run", () => {
  // The repetition complaint that started all of this. Walk a full
  // cycle and assert every line is used exactly once.
  const pool = Array.from({ length: 8 }, (_, i) => line(`l${i}`, null));
  const seen: string[] = [];
  for (let day = 0; day < 8; day++) {
    const pick = pickDriveLine(pool)!;
    seen.push(pick.id);
    pick.sentAt = new Date(Date.UTC(2026, 9, 12 + day));
  }
  assert.equal(new Set(seen).size, 8, `repeated inside one cycle: ${seen.join(", ")}`);
  // And the ninth day comes back round to the first.
  assert.equal(pickDriveLine(pool)!.id, seen[0]);
});

// ── Settings ───────────────────────────────────────────────────────────

test("a send hour inside quiet hours is refused, not silently never run", () => {
  assert.match(
    driveSettingsRefusal(23, { quietFromHour: 22, quietToHour: 8 }) ?? "",
    /falls inside quiet hours/,
  );
  assert.equal(driveSettingsRefusal(19, { quietFromHour: 22, quietToHour: 8 }), null);
});

test("the send hour must be a real hour", () => {
  for (const h of [-1, 24, 9.5]) {
    assert.match(driveSettingsRefusal(h, { quietFromHour: 22, quietToHour: 8 }) ?? "", /whole hour/);
  }
});

// ── The property that matters ──────────────────────────────────────────

test("a drive CANNOT run forever: every exit is reachable on its own", () => {
  // Each of these alone must stop it, with the others left healthy.
  // If someone later makes one of these conditional on another, this
  // is where the argument should happen.
  const exits: [string, Partial<DriveTournamentFacts>][] = [
    ["full draw", { confirmedTeams: 12 }],
    ["status moved on", { status: "REG_CLOSED" }],
    ["admin switch", { regDriveEnabled: false }],
    ["no copy", { enabledLines: 0 }],
  ];
  for (const [label, over] of exits) {
    assert.notEqual(driveRefusal(facts(over), AT_SEND_HOUR), null, `${label} should stop the drive`);
  }
  // And the close date, which needs a later clock rather than a fact.
  assert.notEqual(
    driveRefusal(facts(), new Date("2026-10-25T13:30:00.000Z")),
    null,
    "close date should stop the drive",
  );
});
