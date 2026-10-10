/**
 * The rules of the tournament registration drive.
 *
 * Pure: no database, no request, no clock of its own — the same
 * discipline as lib/daily-push-rules.ts and lib/challenge-rules.ts, for
 * the same reason. A decision taken inside a nightly sweep is a decision
 * nobody can check, and this one decides whether to message the whole
 * customer base.
 *
 * ── WHAT THIS IS, AND WHAT IT IS NOT ──────────────────────────────────
 * The existing campaign (lib/tournament-campaign.ts) is a set of
 * ONE-SHOTS pinned to milestones: registrations opened, pools revealed,
 * we have a champion. Each fires once and is spent.
 *
 * A registration drive is the other shape. "Keep asking until twelve
 * teams have entered" is a recurring job with a stopping condition, and
 * the stopping condition is the whole design. A campaign milestone that
 * fires daily and never stops is a machine for annoying people until
 * they uninstall.
 *
 * So every refusal below is load-bearing, and `driveRefusal` is written
 * to be read aloud: an admin looking at a drive that sent nothing
 * yesterday should get a sentence, not an absence.
 * ──────────────────────────────────────────────────────────────────────
 */

import { istDayKey, istHourOf, inQuietHours } from "@/lib/daily-push-rules";

export { istDayKey, istHourOf };

/** What the drive needs to know about a tournament to judge it. */
export interface DriveTournamentFacts {
  status: string;
  /** Admin switch on the tournament itself. */
  regDriveEnabled: boolean;
  /** IST hour this drive sends at. */
  regDriveHourIST: number;
  /** Registration close time, or null when the venue left it open-ended. */
  regCloseAt: Date | null;
  /** How many teams the draw needs. */
  totalTeams: number;
  /** Teams that have actually paid and are in. */
  confirmedTeams: number;
  /** Teams mid-checkout — counted separately, deliberately. See below. */
  pendingTeams: number;
  /** Enabled drive lines available to rotate through. */
  enabledLines: number;
}

/**
 * Why the drive must not run right now — or null to proceed.
 *
 * Ordered so the reason returned is the most useful one: "the
 * tournament is full" explains a silent drive better than "not the send
 * hour" does, even when both are true at 3pm.
 */
export function driveRefusal(t: DriveTournamentFacts, now: Date): string | null {
  if (!t.regDriveEnabled) return "the registration drive is switched off for this tournament";

  // Only REG_OPEN. PUBLISHED means registration has not opened yet, and
  // driving people to a page that cannot take their money is worse than
  // silence; everything past REG_CLOSED is self-evident.
  if (t.status !== "REG_OPEN") {
    return `registration is not open (status ${t.status})`;
  }

  // ── The stopping condition the venue actually asked for ────────────
  // "Until the registration is completed" means until the draw is full,
  // not until the close date. A tournament that filled on day three
  // must stop asking on day three.
  //
  // CONFIRMED only. A team sitting in PENDING_PAYMENT has not paid, and
  // treating it as a filled spot is how a drive switches itself off on
  // the strength of a checkout somebody abandoned. Counted and reported
  // separately so an admin can see the difference.
  if (t.confirmedTeams >= t.totalTeams) {
    return `the draw is full (${t.confirmedTeams}/${t.totalTeams} confirmed)`;
  }

  if (t.regCloseAt && now >= t.regCloseAt) return "registration has closed";

  // A drive with no copy would claim its audience and send them nothing
  // — the same failure as a daily-push rule whose template is disabled.
  if (t.enabledLines <= 0) return "every line in this drive is switched off";

  const hour = istHourOf(now);
  if (hour !== t.regDriveHourIST) {
    return `not the send hour (now ${hour}:00 IST, set to ${t.regDriveHourIST}:00)`;
  }
  return null;
}

/** Everything the drive knows about one candidate at the moment of a run. */
export interface DriveCandidateFacts {
  /** They turned marketing pushes off in the app. */
  optedOut: boolean;
  /** They already have a team in THIS tournament, in any live state. */
  alreadyEntered: boolean;
  /** This drive has already reached them today — the idempotency fact. */
  alreadySentToday: boolean;
  /** Targeted pushes they have had today, from every source. */
  pushesToday: number;
  /** How many days running this drive has messaged them. */
  consecutiveDays: number;
}

export interface DriveLimits {
  /** Shared ceiling with every other targeted push. 0 disables. */
  maxPushesPerDay: number;
  /**
   * How many days in a row one person may be asked before the drive
   * leaves them alone.
   *
   * ── WHY THIS EXISTS ───────────────────────────────────────────────
   * "Daily until registration completes" is what the venue asked for,
   * and taken literally against a tournament that never fills it is an
   * unbounded sequence of identical asks to somebody who has already
   * decided no. The daily push learned this the expensive way: fifty
   * of fifty-nine people got the same sentence seven days running,
   * and the venue found out because one of them was the owner.
   *
   * Rotating the copy is not a substitute. Varying how you say it does
   * not change that you are asking a tenth time.
   *
   * 0 disables the check, which is a legitimate choice for a flagship
   * event and a bad default.
   */
  maxConsecutiveDays: number;
  quietFromHour: number;
  quietToHour: number;
}

/** Why this person gets nothing from the drive today — or null. */
export function driveSuppression(
  f: DriveCandidateFacts,
  limits: DriveLimits,
): string | null {
  if (f.optedOut) return "opted out";
  // The point of the whole feature. Nobody who has entered gets asked
  // to enter, and this sits above the caps so an admin reading a dry
  // run sees the real reason.
  if (f.alreadyEntered) return "already has a team in this tournament";
  if (f.alreadySentToday) return "already sent today";
  if (limits.maxConsecutiveDays > 0 && f.consecutiveDays >= limits.maxConsecutiveDays) {
    return `asked ${f.consecutiveDays} days running (max ${limits.maxConsecutiveDays})`;
  }
  if (limits.maxPushesPerDay > 0 && f.pushesToday >= limits.maxPushesPerDay) {
    return `already had ${f.pushesToday} push${f.pushesToday === 1 ? "" : "es"} today (max ${limits.maxPushesPerDay})`;
  }
  return null;
}

/**
 * Why these drive settings cannot be saved — or null if coherent.
 *
 * Mirrors settingsRefusal in the daily push: a drive that is "on" but
 * structurally incapable of sending is the worst state, because it
 * reports success and does nothing.
 */
export function driveSettingsRefusal(
  hourIST: number,
  limits: Pick<DriveLimits, "quietFromHour" | "quietToHour">,
): string | null {
  if (!Number.isInteger(hourIST) || hourIST < 0 || hourIST > 23) {
    return "The drive's send hour must be a whole hour between 0 and 23.";
  }
  if (inQuietHours(hourIST, limits.quietFromHour, limits.quietToHour)) {
    return `Send hour ${hourIST}:00 falls inside quiet hours (${limits.quietFromHour}:00–${limits.quietToHour}:00), so the drive would never send.`;
  }
  return null;
}

/**
 * The facts the copy may refer to, computed once per run.
 *
 * Kept to things that are true of the TOURNAMENT rather than of the
 * reader, because this goes out as one multicast — a per-person
 * variable here would send one captain's details to everybody. The
 * daily push enforces the same split by routing personalised rules
 * through sendTemplatedToUser instead.
 */
export interface DriveVars {
  /** e.g. "Momentum October Cup" */
  name: string;
  /** Spots still open, never below zero. */
  spotsLeft: string;
  /** Whole days until registration closes; "" when open-ended. */
  daysLeft: string;
  /** "₹6,100" or "" when there is no pool to boast about. */
  prizePool: string;
  /** "₹3,000" or "free" */
  entryFee: string;
}

export function driveVars(
  t: {
    name: string;
    totalTeams: number;
    confirmedTeams: number;
    regCloseAt: Date | null;
    prizePool: number | null;
    entryFee: number;
  },
  now: Date,
): DriveVars {
  const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;
  return {
    name: t.name,
    spotsLeft: String(Math.max(0, t.totalTeams - t.confirmedTeams)),
    // Ceilinged, matching daysUntil in the daily push: a deadline
    // eleven hours away is "1 day", not "0 days". A zero here would
    // render as "0 days left" on a drive that still has tonight.
    daysLeft: t.regCloseAt
      ? String(Math.max(0, Math.ceil((t.regCloseAt.getTime() - now.getTime()) / 86400_000)))
      : "",
    prizePool: t.prizePool && t.prizePool > 0 ? rupees(t.prizePool) : "",
    entryFee: t.entryFee > 0 ? rupees(t.entryFee) : "free",
  };
}

export interface DriveLine {
  id: string;
  title: string;
  body: string | null;
  enabled: boolean;
  /** Last time this line went out — `sentAt` on the campaign item. */
  sentAt: Date | null;
}

/**
 * Today's drive line, or null when there is nothing to say.
 *
 * Least-recently-used, nulls first, tie-broken on id — identical to
 * pickLine in the daily-push library and deliberately so. Random
 * repeats inside a week on a pool this small, and the repetition is
 * precisely the complaint this rotation exists to avoid.
 */
export function pickDriveLine(lines: DriveLine[]): DriveLine | null {
  const live = lines.filter((l) => l.enabled);
  if (live.length === 0) return null;
  return [...live].sort((a, b) => {
    const at = a.sentAt?.getTime() ?? -1;
    const bt = b.sentAt?.getTime() ?? -1;
    if (at !== bt) return at - bt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  })[0];
}

/**
 * Substitute {placeholders} that the PUSH TEMPLATE does not own.
 *
 * The campaign item carries the sentence; the template carries the
 * envelope. Unknown placeholders are left in place rather than blanked,
 * so a typo in admin-authored copy is visible in the notification
 * instead of silently producing "Only  spots left".
 */
export function renderDriveCopy(text: string, vars: DriveVars): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in vars ? String(vars[key as keyof DriveVars]) : whole,
  );
}
