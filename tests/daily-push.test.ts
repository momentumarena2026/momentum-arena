/**
 * The rules of the daily push.
 *
 * Asserted directly, because this is the one automated push that reaches
 * people who did not ask for it. Every test below is really the same
 * question in a different costume: can this module send something it
 * should not have? The boundaries matter more than the happy paths —
 * "30 days" being true at 29 is a lie in the copy, and a cap that is
 * off-by-one is a cap that does not exist.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  istDayKey,
  istDayStart,
  istHourOf,
  daysSince,
  daysUntil,
  inQuietHours,
  runRefusal,
  suppressionReason,
  matchRule,
  decide,
  settingsRefusal,
  RULE_PRIORITY,
  RULE_LABEL,
  type CandidateFacts,
  type DailyPushLimits,
  type VenueFacts,
} from "../lib/daily-push-rules";
import { inQuietHours as challengeInQuietHours } from "../lib/challenge-rules";

// ── Fixtures ───────────────────────────────────────────────────────────

const LIMITS: DailyPushLimits = {
  enabled: true,
  sendHourIST: 19,
  quietFromHour: 22,
  quietToHour: 8,
  maxPerUserPerWeek: 2,
  skipIfBookedSoon: true,
  skipIfPushedToday: true,
  passExpiry: { enabled: true, days: 3 },
  neverBooked: { enabled: true, days: 7 },
  lapsed: { enabled: true, days: 30 },
  freeSlots: { enabled: true, fromHour: 18, minOpen: 2 },
};

/** Eligible, matches nothing personal. The baseline every test deviates from. */
const CLEAN: CandidateFacts = {
  optedOut: false,
  sendsInLastWeek: 0,
  alreadySentToday: false,
  hadTargetedPushToday: false,
  hasBookingSoon: false,
  passExpiryInDays: null,
  accountAgeDays: 200,
  daysSinceLastBooking: 2,
};

const BUSY: VenueFacts = { freeSlotsTonight: 5 };
const FULL: VenueFacts = { freeSlotsTonight: 0 };

const limits = (over: Partial<DailyPushLimits> = {}): DailyPushLimits => ({
  ...LIMITS,
  ...over,
});
const who = (over: Partial<CandidateFacts> = {}): CandidateFacts => ({
  ...CLEAN,
  ...over,
});

/** 19:00 IST on 26 Sep 2026 == 13:30 UTC. */
const AT_7PM_IST = new Date("2026-09-26T13:30:00.000Z");

// ── Time helpers ───────────────────────────────────────────────────────

test("istDayStart anchors to IST midnight, not UTC midnight", () => {
  // 00:30 IST on the 27th is still 19:00 UTC on the 26th. A UTC-anchored
  // day would file this under the 26th and let the same person be sent to
  // twice across one IST night.
  const justAfterISTMidnight = new Date("2026-09-26T19:00:00.000Z");
  assert.equal(istDayStart(justAfterISTMidnight).toISOString(), "2026-09-26T18:30:00.000Z");

  // ...and 23:00 IST the previous evening belongs to the day before.
  const lateEvening = new Date("2026-09-26T17:30:00.000Z");
  assert.equal(istDayStart(lateEvening).toISOString(), "2026-09-25T18:30:00.000Z");
});

test("istDayKey is the IST CALENDAR DATE, which istDayStart is not", () => {
  // The bug this pins cost a real one. `sentOn` is a @db.Date; handing
  // it istDayStart stored the IST day of the 26th as the 25th, and made
  // the idempotency comparison permanently false — so the in-memory
  // guard was dead code and a mixed bucket would have re-sent.
  // Found by driving the engine against staging, invisible to any test
  // that does not cross the database boundary. These two must never be
  // confused again.
  const evening = new Date("2026-09-26T15:07:58.142Z"); // 20:37 IST on the 26th

  assert.equal(istDayStart(evening).toISOString(), "2026-09-25T18:30:00.000Z");
  assert.equal(istDayKey(evening).toISOString(), "2026-09-26T00:00:00.000Z");
  assert.notEqual(istDayStart(evening).getTime(), istDayKey(evening).getTime());

  // A @db.Date round-trip yields UTC midnight, so only istDayKey can
  // ever compare equal to a value read back out of that column.
  const roundTripped = new Date(istDayKey(evening).toISOString().slice(0, 10) + "T00:00:00.000Z");
  assert.equal(roundTripped.getTime(), istDayKey(evening).getTime());

  // The IST date, not the UTC one, across the window where they differ.
  assert.equal(istDayKey(new Date("2026-09-26T18:29:00.000Z")).toISOString().slice(0, 10), "2026-09-26");
  assert.equal(istDayKey(new Date("2026-09-26T18:30:00.000Z")).toISOString().slice(0, 10), "2026-09-27");
  assert.equal(istDayKey(new Date("2026-09-26T00:30:00.000Z")).toISOString().slice(0, 10), "2026-09-26");
});

test("istHourOf reads the IST wall clock", () => {
  assert.equal(istHourOf(AT_7PM_IST), 19);
  assert.equal(istHourOf(new Date("2026-09-26T18:30:00.000Z")), 0); // IST midnight
  assert.equal(istHourOf(new Date("2026-09-26T02:29:00.000Z")), 7);
});

test("daysSince floors and daysUntil ceilings, deliberately in opposite directions", () => {
  const now = new Date("2026-09-26T13:30:00.000Z");

  // 29 days and 13 hours is not yet 30 days: the copy says "you haven't
  // played in 30 days" and it has to be true when it says it.
  assert.equal(daysSince(new Date("2026-08-28T00:30:00.000Z"), now), 29);
  assert.equal(daysSince(new Date("2026-08-27T13:30:00.000Z"), now), 30);
  assert.equal(daysSince(new Date("2026-09-27T13:30:00.000Z"), now), 0, "future clamps to 0");

  // A pass with 11 hours left expires "in 1 day", never "in 0 days".
  assert.equal(daysUntil(new Date("2026-09-27T00:30:00.000Z"), now), 1);
  assert.equal(daysUntil(new Date("2026-09-29T13:30:00.000Z"), now), 3);
  assert.equal(daysUntil(new Date("2026-09-25T13:30:00.000Z"), now), 0, "past clamps to 0");
});

// ── Quiet hours ────────────────────────────────────────────────────────

test("quiet hours wrap past midnight", () => {
  assert.equal(inQuietHours(23, 22, 8), true);
  assert.equal(inQuietHours(3, 22, 8), true);
  assert.equal(inQuietHours(22, 22, 8), true, "start is inclusive");
  assert.equal(inQuietHours(8, 22, 8), false, "end is exclusive");
  assert.equal(inQuietHours(19, 22, 8), false);
});

test("quiet hours handle a same-day window and a disabled one", () => {
  assert.equal(inQuietHours(10, 9, 17), true);
  assert.equal(inQuietHours(18, 9, 17), false);
  assert.equal(inQuietHours(3, 12, 12), false, "from === to means no quiet hours at all");
});

test("quiet hours agree with the challenge board's copy of the same rule", () => {
  // The two are intentionally separate functions (see the note in
  // lib/daily-push-rules.ts). This pins them together so the duplication
  // stays a choice rather than a drift.
  for (let h = 0; h < 24; h++) {
    for (const [from, to] of [[22, 8], [9, 17], [0, 0], [12, 12], [23, 1]] as const) {
      assert.equal(
        inQuietHours(h, from, to),
        challengeInQuietHours(h, from, to),
        `hour ${h} in ${from}–${to}`,
      );
    }
  }
});

// ── Whether the run happens at all ─────────────────────────────────────

test("the run refuses unless it is switched on, and at the right hour", () => {
  assert.match(runRefusal(limits({ enabled: false }), AT_7PM_IST) ?? "", /switched off/);
  assert.equal(runRefusal(LIMITS, AT_7PM_IST), null);

  // An hour either side does nothing. The cron fires hourly; only one of
  // those 24 wakeups is the send.
  assert.match(
    runRefusal(LIMITS, new Date("2026-09-26T12:30:00.000Z")) ?? "",
    /not the send hour/,
  );
  assert.match(
    runRefusal(LIMITS, new Date("2026-09-26T14:30:00.000Z")) ?? "",
    /not the send hour/,
  );
});

test("quiet hours beat the send hour when the two settings disagree", () => {
  // settingsRefusal should stop this reaching the database, but a row
  // written before that guard existed must not start sending at 11pm.
  const bad = limits({ sendHourIST: 23 });
  const at11pm = new Date("2026-09-26T17:30:00.000Z");
  assert.equal(istHourOf(at11pm), 23);
  assert.match(runRefusal(bad, at11pm) ?? "", /quiet hours/);
});

// ── Suppression ────────────────────────────────────────────────────────

test("an opted-out person is never sent to, whatever else is true", () => {
  const optedOut = who({ optedOut: true, passExpiryInDays: 0 });
  assert.equal(suppressionReason(optedOut, LIMITS), "opted out");
  const d = decide(optedOut, LIMITS, BUSY);
  assert.equal(d.send, false);
  // ...but the dry run still reports what they WOULD have got, which is
  // how an admin tells "nobody matched" apart from "everybody opted out".
  assert.equal(d.send === false && d.wouldHaveMatched, "PASS_EXPIRY");
});

test("the weekly cap is a ceiling, not a target", () => {
  assert.equal(suppressionReason(who({ sendsInLastWeek: 1 }), LIMITS), null);
  assert.match(
    suppressionReason(who({ sendsInLastWeek: 2 }), LIMITS) ?? "",
    /weekly cap reached \(2\/2\)/,
  );
  assert.match(
    suppressionReason(who({ sendsInLastWeek: 9 }), LIMITS) ?? "",
    /weekly cap reached/,
  );
});

test("a zero weekly cap silences the module for everyone", () => {
  assert.match(
    suppressionReason(who(), limits({ maxPerUserPerWeek: 0 })) ?? "",
    /cap is zero/,
  );
});

test("idempotency beats everything except the opt-out", () => {
  // Two overlapping cron runs: the second must find the first's row and
  // stop, or the audience gets the same message twice in a minute.
  assert.equal(suppressionReason(who({ alreadySentToday: true }), LIMITS), "already sent today");
});

test("the two 'leave them alone' guards can each be switched off", () => {
  const booked = who({ hasBookingSoon: true });
  assert.match(suppressionReason(booked, LIMITS) ?? "", /booking today or tomorrow/);
  assert.equal(suppressionReason(booked, limits({ skipIfBookedSoon: false })), null);

  const heard = who({ hadTargetedPushToday: true });
  assert.match(suppressionReason(heard, LIMITS) ?? "", /already heard from us today/);
  assert.equal(suppressionReason(heard, limits({ skipIfPushedToday: false })), null);
});

test("a booking today suppresses even a pass about to expire", () => {
  // Faithful to the chosen guard rather than to my opinion of it. Pinned
  // so that if the venue later decides money-about-to-vanish should
  // outrank "they are already playing", the change is a deliberate one
  // with a failing test attached, not a silent drift.
  const d = decide(who({ hasBookingSoon: true, passExpiryInDays: 1 }), LIMITS, BUSY);
  assert.equal(d.send, false);
  assert.equal(d.send === false && d.wouldHaveMatched, "PASS_EXPIRY");
});

// ── Matching ───────────────────────────────────────────────────────────

test("pass expiry outranks every other rule", () => {
  // Someone who is lapsed AND has a pass running out hears about the
  // money, not the absence.
  assert.equal(
    matchRule(who({ passExpiryInDays: 2, daysSinceLastBooking: 400 }), LIMITS, BUSY),
    "PASS_EXPIRY",
  );
});

test("pass expiry fires on the threshold day and not the day before", () => {
  assert.equal(matchRule(who({ passExpiryInDays: 3 }), LIMITS, FULL), "PASS_EXPIRY");
  assert.equal(matchRule(who({ passExpiryInDays: 4 }), LIMITS, FULL), null);
  // Expiring today still counts — that is the last chance to say it.
  assert.equal(matchRule(who({ passExpiryInDays: 0 }), LIMITS, FULL), "PASS_EXPIRY");
});

test("never-booked needs the account to be old enough to have had a chance", () => {
  const fresh = who({ daysSinceLastBooking: null, accountAgeDays: 6 });
  assert.equal(matchRule(fresh, LIMITS, FULL), null, "installed yesterday is not 'never booked'");

  const settled = who({ daysSinceLastBooking: null, accountAgeDays: 7 });
  assert.equal(matchRule(settled, LIMITS, FULL), "NEVER_BOOKED");
});

test("lapsed needs a booking history, never-booked needs the absence of one", () => {
  assert.equal(matchRule(who({ daysSinceLastBooking: 30 }), LIMITS, FULL), "LAPSED");
  assert.equal(matchRule(who({ daysSinceLastBooking: 29 }), LIMITS, FULL), null);

  // The two are mutually exclusive by construction; this pins it.
  const never = who({ daysSinceLastBooking: null, accountAgeDays: 999 });
  assert.equal(matchRule(never, LIMITS, FULL), "NEVER_BOOKED");
});

test("free slots is a fallback, and only when the slots are real", () => {
  const ordinary = who(); // booked 2 days ago, no pass — no personal rule
  assert.equal(matchRule(ordinary, LIMITS, BUSY), "FREE_SLOTS");

  // The honesty condition: a full night says nothing rather than
  // inventing availability.
  assert.equal(matchRule(ordinary, LIMITS, FULL), null);
  assert.equal(matchRule(ordinary, LIMITS, { freeSlotsTonight: 1 }), null, "below minOpen");
  assert.equal(matchRule(ordinary, LIMITS, { freeSlotsTonight: 2 }), "FREE_SLOTS", "at minOpen");
});

test("a minOpen below 1 cannot be used to claim slots that do not exist", () => {
  const zeroed = limits({ freeSlots: { enabled: true, fromHour: 18, minOpen: 0 } });
  assert.equal(matchRule(who(), zeroed, FULL), null, "0 free slots never fires, whatever minOpen says");
  assert.equal(matchRule(who(), zeroed, { freeSlotsTonight: 1 }), "FREE_SLOTS");
});

test("each rule can be switched off independently and the next one takes over", () => {
  const expiring = who({ passExpiryInDays: 1, daysSinceLastBooking: 90 });
  assert.equal(matchRule(expiring, LIMITS, BUSY), "PASS_EXPIRY");

  const noPassRule = limits({ passExpiry: { enabled: false, days: 3 } });
  assert.equal(matchRule(expiring, noPassRule, BUSY), "LAPSED");

  const noLapsed = limits({
    passExpiry: { enabled: false, days: 3 },
    lapsed: { enabled: false, days: 30 },
  });
  assert.equal(matchRule(expiring, noLapsed, BUSY), "FREE_SLOTS");

  const nothing = limits({
    passExpiry: { enabled: false, days: 3 },
    lapsed: { enabled: false, days: 30 },
    freeSlots: { enabled: false, fromHour: 18, minOpen: 2 },
  });
  assert.equal(matchRule(expiring, nothing, BUSY), null);
});

test("every rule in the priority list has a label and appears exactly once", () => {
  assert.equal(new Set(RULE_PRIORITY).size, RULE_PRIORITY.length);
  for (const k of RULE_PRIORITY) {
    assert.ok(RULE_LABEL[k], `${k} has no admin label`);
  }
  assert.equal(Object.keys(RULE_LABEL).length, RULE_PRIORITY.length);
});

// ── decide() ───────────────────────────────────────────────────────────

test("decide sends when a rule matches and nothing suppresses", () => {
  const d = decide(who({ passExpiryInDays: 1 }), LIMITS, FULL);
  assert.deepEqual(d, { send: true, rule: "PASS_EXPIRY" });
});

test("decide distinguishes 'nothing to say' from 'not allowed to say it'", () => {
  const quiet = decide(who(), LIMITS, FULL);
  assert.equal(quiet.send, false);
  assert.equal(quiet.send === false && quiet.reason, "nothing to say");

  const capped = decide(who({ sendsInLastWeek: 2 }), LIMITS, BUSY);
  assert.equal(capped.send, false);
  assert.match(capped.send === false ? capped.reason : "", /weekly cap/);
  assert.equal(capped.send === false && capped.wouldHaveMatched, "FREE_SLOTS");
});

// ── Settings validation ────────────────────────────────────────────────

test("settings that could never fire are refused rather than saved", () => {
  assert.equal(settingsRefusal(LIMITS), null);

  assert.match(
    settingsRefusal(limits({ sendHourIST: 23 })) ?? "",
    /falls inside quiet hours/,
  );
  assert.match(
    settingsRefusal(limits({ sendHourIST: 3 })) ?? "",
    /falls inside quiet hours/,
  );
  assert.match(settingsRefusal(limits({ sendHourIST: 24 })) ?? "", /between 0 and 23/);
  assert.match(settingsRefusal(limits({ sendHourIST: 19.5 })) ?? "", /whole hour/);
});

test("an enabled module with every rule off is refused", () => {
  const mute = limits({
    passExpiry: { enabled: false, days: 3 },
    neverBooked: { enabled: false, days: 7 },
    lapsed: { enabled: false, days: 30 },
    freeSlots: { enabled: false, fromHour: 18, minOpen: 2 },
  });
  assert.match(settingsRefusal(mute) ?? "", /nothing it could ever say/);

  // Switched off, the same combination is fine — that is just a parked module.
  assert.equal(settingsRefusal({ ...mute, enabled: false }), null);
});

test("the weekly cap is bounded at both ends", () => {
  assert.equal(settingsRefusal(limits({ maxPerUserPerWeek: 0 })), null, "zero is a valid mute");
  assert.match(settingsRefusal(limits({ maxPerUserPerWeek: -1 })) ?? "", /zero or a whole number/);
  assert.match(settingsRefusal(limits({ maxPerUserPerWeek: 8 })) ?? "", /cannot exceed 7/);
  assert.equal(settingsRefusal(limits({ maxPerUserPerWeek: 7 })), null);
});

test("rule thresholds must be whole non-negative days", () => {
  assert.match(
    settingsRefusal(limits({ lapsed: { enabled: true, days: -5 } })) ?? "",
    /Lapsed: the day threshold/,
  );
  assert.match(
    settingsRefusal(limits({ passExpiry: { enabled: true, days: 1.5 } })) ?? "",
    /Pass expiry: the day threshold/,
  );
  // A disabled rule's nonsense threshold is not worth refusing a save over.
  assert.equal(settingsRefusal(limits({ lapsed: { enabled: false, days: -5 } })), null);
});

test("free-slots settings are bounded", () => {
  assert.match(
    settingsRefusal(limits({ freeSlots: { enabled: true, fromHour: 99, minOpen: 2 } })) ?? "",
    /between 0 and 23/,
  );
  assert.match(
    settingsRefusal(limits({ freeSlots: { enabled: true, fromHour: 18, minOpen: 0 } })) ?? "",
    /at least 1/,
  );
});
