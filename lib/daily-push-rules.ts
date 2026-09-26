/**
 * The rules of the daily push.
 *
 * Pure: no database, no request, no clock of its own. Every function is
 * handed the facts and the moment to judge them against, which is what
 * lets the engine, the admin dry run and the tests all reach the same
 * verdict. The same discipline as lib/challenge-rules.ts, and for the
 * same reason — a decision that lives in a sweep is a decision nobody
 * can check.
 *
 * ── WHAT MAKES THIS ONE DIFFERENT ─────────────────────────────────────
 * Every other automated push in this product is transactional: something
 * happened TO you, so you get told. This is the venue starting the
 * conversation with people who did not ask, which flips the default. The
 * question a transactional push asks is "did the thing happen?". The
 * question here is "is there any reason NOT to?", and there are five of
 * them before we even get to whether we have anything to say.
 * ──────────────────────────────────────────────────────────────────────
 */

/**
 * Midnight IST for the day `now` falls in, as a UTC instant.
 *
 * For comparing against TIMESTAMP columns — `createdAt >= istDayStart(now)`
 * is "since midnight tonight, IST". Do NOT store this in a `@db.Date`
 * column; use `istDayKey` for that, and read the note there for what
 * goes wrong when you don't.
 */
export function istDayStart(now: Date): Date {
  const IST = 5.5 * 3600_000;
  const ist = new Date(now.getTime() + IST);
  return new Date(
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST,
  );
}

/**
 * The IST calendar DATE, as the UTC-midnight instant a `@db.Date`
 * column round-trips unchanged.
 *
 * ── WHY THIS IS SEPARATE FROM istDayStart ─────────────────────────────
 * `istDayStart` returns 18:30 UTC of the PREVIOUS calendar day, because
 * that is genuinely when the IST day began. Handing that to a `@db.Date`
 * column does two silent, compounding things:
 *
 *   - Postgres truncates it to the UTC date part, so the IST day of the
 *     26th is stored as the 25th — the uniqueness key lands on the wrong
 *     day.
 *   - It reads back as 00:00 UTC, so `row.sentOn.getTime() === dayStart
 *     .getTime()` is NEVER true, and any idempotency check written that
 *     way is dead code that reports success.
 *
 * Both were live in the daily push and neither was visible to a unit
 * test, because the bug lives in the database round-trip rather than in
 * the arithmetic. Found by driving the real engine against staging.
 * ──────────────────────────────────────────────────────────────────────
 */
export function istDayKey(now: Date): Date {
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
}

/** Hour of the IST day, 0–23. */
export function istHourOf(now: Date): number {
  return new Date(now.getTime() + 5.5 * 3600_000).getUTCHours();
}

/**
 * Whole days from `then` to `now`, floored, never negative.
 *
 * Floored rather than rounded because these read as thresholds in
 * sentences an admin writes: "hasn't booked in 30 days" must not become
 * true at 29 days and 13 hours, or the copy is lying by half a day.
 */
export function daysSince(then: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - then.getTime()) / 86400_000));
}

/** Whole days from `now` until `then`, ceilinged, never negative.
 *
 *  Ceilinged, which is the opposite of daysSince and deliberately so: a
 *  pass with eleven hours left expires "in 1 day", not "in 0 days". A
 *  zero here would read as "expires today" on a pass that still has
 *  tonight on it. */
export function daysUntil(then: Date, now: Date): number {
  return Math.max(0, Math.ceil((then.getTime() - now.getTime()) / 86400_000));
}

// ── The rules ──────────────────────────────────────────────────────────

export type DailyPushRuleKey =
  /** Money about to vanish: balance left on a pass that lapses soon. */
  | "PASS_EXPIRY"
  /** Installed, never played. */
  | "NEVER_BOOKED"
  /** Played once, has gone quiet. */
  | "LAPSED"
  /** The venue-wide fallback — courts are actually free tonight. */
  | "FREE_SLOTS";

/**
 * Priority order. First match wins, per person.
 *
 * NEVER_BOOKED above LAPSED is documentation rather than arbitration —
 * the two cannot both be true. PASS_EXPIRY above everything is the real
 * decision: it is the only rule where saying nothing costs the customer
 * money rather than costing the venue a booking.
 */
export const RULE_PRIORITY: readonly DailyPushRuleKey[] = [
  "PASS_EXPIRY",
  "NEVER_BOOKED",
  "LAPSED",
  "FREE_SLOTS",
] as const;

/** Admin-facing label. Used by the dashboard and the dry run. */
export const RULE_LABEL: Record<DailyPushRuleKey, string> = {
  PASS_EXPIRY: "Pass about to expire",
  NEVER_BOOKED: "Installed but never booked",
  LAPSED: "Booked before, gone quiet",
  FREE_SLOTS: "Free slots tonight",
};

export interface RuleToggle {
  enabled: boolean;
  /** Threshold in days. Unused by FREE_SLOTS. */
  days: number;
}

export interface DailyPushLimits {
  enabled: boolean;
  sendHourIST: number;
  quietFromHour: number;
  quietToHour: number;
  maxPerUserPerWeek: number;
  skipIfBookedSoon: boolean;
  skipIfPushedToday: boolean;
  passExpiry: RuleToggle;
  neverBooked: RuleToggle;
  lapsed: RuleToggle;
  freeSlots: { enabled: boolean; fromHour: number; minOpen: number };
}

/** Everything the engine knows about one person at the moment of a run. */
export interface CandidateFacts {
  /** They turned the daily push off in the app. */
  optedOut: boolean;
  /** Daily pushes they have had in the trailing seven days. */
  sendsInLastWeek: number;
  /** Already sent to today — the idempotency fact, not a preference. */
  alreadySentToday: boolean;
  /** Had a TARGETED push today. Multicasts are invisible here; see
   *  PushDispatch.userId in the schema for exactly what that misses. */
  hadTargetedPushToday: boolean;
  /** Has a booking today or tomorrow. */
  hasBookingSoon: boolean;
  /** Days until the soonest-expiring pass that still has balance on it. */
  passExpiryInDays: number | null;
  /** Days since the account was created. */
  accountAgeDays: number;
  /** Days since their most recent booking; null when they never booked. */
  daysSinceLastBooking: number | null;
}

/** What the venue itself looks like tonight. Shared by every candidate. */
export interface VenueFacts {
  /** Free slots from `freeSlots.fromHour` onward, across all courts. */
  freeSlotsTonight: number;
}

/**
 * Why the whole run must not happen right now — or null to proceed.
 *
 * Separate from the per-person check because these are different kinds of
 * "no": this one means the cron should return having done nothing, and
 * nobody should be evaluated at all.
 */
export function runRefusal(limits: DailyPushLimits, now: Date): string | null {
  if (!limits.enabled) return "the daily push is switched off";
  const hour = istHourOf(now);
  if (hour !== limits.sendHourIST) {
    return `not the send hour (now ${hour}:00 IST, set to ${limits.sendHourIST}:00)`;
  }
  // Checked even though the hour matched, because the two settings can
  // disagree — and when they do, quiet hours win. An admin who sets the
  // send time inside the quiet window has made a mistake, and the safe
  // reading of a mistake is to send nothing.
  if (inQuietHours(hour, limits.quietFromHour, limits.quietToHour)) {
    return "quiet hours";
  }
  return null;
}

/**
 * Whether `istHour` falls inside a window that may wrap past midnight.
 *
 * Mirrors lib/challenge-rules.ts#inQuietHours rather than importing it:
 * that module is the challenge board's, and a shared helper between two
 * feature rule-sets is a coupling that gets paid for later when one of
 * them needs the semantics changed. Four lines is cheaper than the
 * coupling. The parity of the two is pinned by a test.
 */
export function inQuietHours(istHour: number, from: number, to: number): boolean {
  if (from === to) return false;
  return from < to ? istHour >= from && istHour < to : istHour >= from || istHour < to;
}

/**
 * Why this person gets nothing today — or null if they are eligible.
 *
 * Ordered cheapest-and-most-absolute first, so the reason returned is the
 * one worth showing an admin in the dry run: "opted out" explains a
 * person's absence better than "capped" does, even when both are true.
 */
export function suppressionReason(
  f: CandidateFacts,
  limits: DailyPushLimits,
): string | null {
  if (f.optedOut) return "opted out";
  if (f.alreadySentToday) return "already sent today";
  if (limits.maxPerUserPerWeek <= 0) return "weekly cap is zero";
  if (f.sendsInLastWeek >= limits.maxPerUserPerWeek) {
    return `weekly cap reached (${f.sendsInLastWeek}/${limits.maxPerUserPerWeek})`;
  }
  if (limits.skipIfBookedSoon && f.hasBookingSoon) return "has a booking today or tomorrow";
  if (limits.skipIfPushedToday && f.hadTargetedPushToday) return "already heard from us today";
  return null;
}

/**
 * The highest-priority rule true for this person, or null if none is.
 *
 * Does NOT consider suppression — that is `suppressionReason`'s job, and
 * keeping them apart is what lets the dry run report "would have matched
 * LAPSED, but they are capped", which is a far more useful thing for an
 * admin to read than a missing row.
 */
export function matchRule(
  f: CandidateFacts,
  limits: DailyPushLimits,
  venue: VenueFacts,
): DailyPushRuleKey | null {
  for (const key of RULE_PRIORITY) {
    switch (key) {
      case "PASS_EXPIRY":
        if (
          limits.passExpiry.enabled &&
          f.passExpiryInDays !== null &&
          f.passExpiryInDays <= limits.passExpiry.days
        ) {
          return "PASS_EXPIRY";
        }
        break;

      case "NEVER_BOOKED":
        if (
          limits.neverBooked.enabled &&
          f.daysSinceLastBooking === null &&
          f.accountAgeDays >= limits.neverBooked.days
        ) {
          return "NEVER_BOOKED";
        }
        break;

      case "LAPSED":
        if (
          limits.lapsed.enabled &&
          f.daysSinceLastBooking !== null &&
          f.daysSinceLastBooking >= limits.lapsed.days
        ) {
          return "LAPSED";
        }
        break;

      case "FREE_SLOTS":
        // The only rule that can be true for one person and false for the
        // next purely because of the venue. It is also the only one that
        // can make the product lie: "3 slots open tonight" on a full
        // night is worse than silence, so the count is a precondition,
        // not a decoration on the copy.
        if (
          limits.freeSlots.enabled &&
          venue.freeSlotsTonight >= Math.max(1, limits.freeSlots.minOpen)
        ) {
          return "FREE_SLOTS";
        }
        break;
    }
  }
  return null;
}

export type Decision =
  | { send: true; rule: DailyPushRuleKey }
  | { send: false; reason: string; wouldHaveMatched: DailyPushRuleKey | null };

/** Suppression and matching together — what the engine and dry run call. */
export function decide(
  f: CandidateFacts,
  limits: DailyPushLimits,
  venue: VenueFacts,
): Decision {
  const matched = matchRule(f, limits, venue);
  const blocked = suppressionReason(f, limits);
  if (blocked) return { send: false, reason: blocked, wouldHaveMatched: matched };
  if (!matched) return { send: false, reason: "nothing to say", wouldHaveMatched: null };
  return { send: true, rule: matched };
}

/**
 * Why these settings cannot be saved — or null if they are coherent.
 *
 * The admin form refuses on this rather than accepting a combination that
 * silently never fires. A module that is "on" but structurally incapable
 * of sending is the worst of the three states, because it reports success
 * and does nothing; better to refuse the save and say which two fields
 * disagree.
 */
export function settingsRefusal(limits: DailyPushLimits): string | null {
  const whole = (n: number) => Number.isInteger(n);
  const hour = (n: number) => whole(n) && n >= 0 && n <= 23;

  if (!hour(limits.sendHourIST)) return "Send hour must be a whole hour between 0 and 23.";
  if (!hour(limits.quietFromHour) || !hour(limits.quietToHour)) {
    return "Quiet hours must be whole hours between 0 and 23.";
  }
  if (!hour(limits.freeSlots.fromHour)) {
    return "The 'tonight starts at' hour must be between 0 and 23.";
  }
  if (inQuietHours(limits.sendHourIST, limits.quietFromHour, limits.quietToHour)) {
    return `Send hour ${limits.sendHourIST}:00 falls inside quiet hours (${limits.quietFromHour}:00–${limits.quietToHour}:00), so nothing would ever send.`;
  }
  if (!whole(limits.maxPerUserPerWeek) || limits.maxPerUserPerWeek < 0) {
    return "The weekly cap must be zero or a whole number.";
  }
  if (limits.maxPerUserPerWeek > 7) {
    return "The weekly cap cannot exceed 7 — one a day is already the most this module can send.";
  }
  for (const [label, r] of [
    ["Pass expiry", limits.passExpiry],
    ["Never booked", limits.neverBooked],
    ["Lapsed", limits.lapsed],
  ] as const) {
    if (r.enabled && (!whole(r.days) || r.days < 0)) {
      return `${label}: the day threshold must be zero or a whole number.`;
    }
  }
  if (limits.freeSlots.enabled && (!whole(limits.freeSlots.minOpen) || limits.freeSlots.minOpen < 1)) {
    return "Free slots: the minimum open count must be at least 1.";
  }
  // Enabled with every rule off is the other way to build a module that
  // cannot speak. Caught here rather than discovered in a week of empty runs.
  if (
    limits.enabled &&
    !limits.passExpiry.enabled &&
    !limits.neverBooked.enabled &&
    !limits.lapsed.enabled &&
    !limits.freeSlots.enabled
  ) {
    return "Every rule is switched off, so the daily push has nothing it could ever say.";
  }
  return null;
}
