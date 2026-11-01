/**
 * How much the cron schedule costs us in database compute.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────
 * In October 2026 the Neon bill doubled, from under $20 to about $40,
 * and nothing about traffic had changed. Two crons had moved to a
 * one-minute schedule on 20-21 September. Neon bills COMPUTE TIME and an
 * idle compute suspends only after a few minutes without a query, so a
 * query every sixty seconds meant the production database never slept
 * again. The crons themselves found nothing — one of them queried a
 * table that has never held a row.
 *
 * Nothing caught it. The change was small, correct on its own terms, and
 * its cost was invisible at review time. `docs/NEON-COMPUTE-COST.md` has
 * the full diagnosis.
 *
 * This module turns that cost into a NUMBER that CI can compare against
 * a committed baseline, the same way the mobile typecheck is held to its
 * 15 errors. The number is `awakeMinutesPerDay`: how long the compute is
 * kept out of suspension by scheduled work alone.
 *
 * ── WHAT IT DOES AND DOES NOT COVER ───────────────────────────────────
 * It models SCHEDULED work only, because that is what is declared in the
 * repo and therefore reviewable. It does not and cannot see:
 *
 *   - real customer traffic (which is the cost we WANT to pay)
 *   - how heavy a query is, i.e. CU above the 0.25 floor
 *   - a new Neon branch or endpoint created in the console
 *   - a connection held open by something outside vercel.json
 *
 * So a green check is not proof the bill cannot rise. It is proof that
 * THE THING THAT ACTUALLY HAPPENED cannot happen again unnoticed.
 */

/** Neon suspends an idle compute after this long. 0 in the API means this default. */
export const DEFAULT_SUSPEND_SECONDS = 300;

export interface CronEntry {
  path: string;
  schedule: string;
}

export interface CostReport {
  /** Minutes per day the compute is held awake by scheduled work. */
  awakeMinutesPerDay: number;
  /** Share of the day, 0–1. */
  uptimeFraction: number;
  /** CU-hours a month at Neon's 0.25 CU floor, 30-day month. */
  cuHoursPerMonth: number;
  /** Distinct moments in the day something fires. */
  wakeEventsPerDay: number;
  /** Total cron invocations a day across every entry. */
  invocationsPerDay: number;
  /** Entries whose own cadence is tighter than the suspend window. */
  alwaysOn: string[];
}

/**
 * Expand one field of a cron expression into the values it matches.
 *
 * Handles `*`, `*​/n`, `a`, `a-b`, and comma-separated lists of those —
 * which covers everything this repo uses and the shapes most likely to
 * appear next. Anything else THROWS rather than returning a guess: an
 * unparsed field silently treated as "fires rarely" would make this
 * check lie in the one direction that matters.
 */
export function expandField(field: string, min: number, max: number): number[] {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const [range, stepStr] = part.split("/");
    const step = stepStr === undefined ? 1 : Number(stepStr);
    if (!Number.isInteger(step) || step < 1) {
      throw new Error(`Unsupported cron step in "${field}"`);
    }
    let lo = min;
    let hi = max;
    if (range !== "*") {
      const bounds = range.split("-");
      if (bounds.length === 1) {
        lo = hi = Number(bounds[0]);
      } else if (bounds.length === 2) {
        lo = Number(bounds[0]);
        hi = Number(bounds[1]);
      } else {
        throw new Error(`Unsupported cron range in "${field}"`);
      }
      if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) {
        throw new Error(`Cron field out of bounds: "${field}"`);
      }
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Every minute-of-day (0–1439) at which a schedule fires.
 *
 * Day-of-month and day-of-week are deliberately IGNORED, which makes a
 * weekly job count as if it ran daily. That over-estimates, and
 * over-estimating is the safe direction for a cost ceiling: the check
 * can be too cautious, never too permissive.
 */
export function fireMinutes(schedule: string): number[] {
  const f = schedule.trim().split(/\s+/);
  if (f.length !== 5) {
    throw new Error(`Expected a 5-field cron expression, got "${schedule}"`);
  }
  const minutes = expandField(f[0], 0, 59);
  const hours = expandField(f[1], 0, 23);
  const out: number[] = [];
  for (const h of hours) for (const m of minutes) out.push(h * 60 + m);
  return out.sort((a, b) => a - b);
}

/**
 * What the schedule costs, in compute the database cannot suspend.
 *
 * Each fire holds the compute awake for `suspendSeconds` afterwards.
 * Overlapping holds are merged — four crons on the same minute cost ONE
 * window, which is why clustering them is the whole fix. The day wraps:
 * a 23:50 fire with a 5-minute window still holds 00:00 the next day,
 * and every day is the same, so the wrap is folded back to the start.
 */
export function cronCost(
  crons: CronEntry[],
  suspendSeconds: number = DEFAULT_SUSPEND_SECONDS,
): CostReport {
  const hold = Math.max(1, Math.ceil(suspendSeconds / 60));
  const DAY = 1440;

  const awake = new Array<boolean>(DAY).fill(false);
  const fires = new Set<number>();
  let invocations = 0;
  const alwaysOn: string[] = [];

  for (const c of crons) {
    const mins = fireMinutes(c.schedule);
    invocations += mins.length;
    for (const m of mins) {
      fires.add(m);
      for (let i = 0; i < hold; i++) awake[(m + i) % DAY] = true;
    }
    // A cadence tighter than the suspend window can never let go: the
    // idle timer is reset before it elapses. Called out by name because
    // it is the specific shape that doubled the bill.
    if (mins.length > 1) {
      const gaps = mins.slice(1).map((m, i) => m - mins[i]);
      gaps.push(DAY - mins[mins.length - 1] + mins[0]);
      if (Math.max(...gaps) <= hold) alwaysOn.push(c.path);
    }
  }

  const awakeMinutesPerDay = awake.filter(Boolean).length;
  return {
    awakeMinutesPerDay,
    uptimeFraction: awakeMinutesPerDay / DAY,
    // 0.25 CU is Neon's floor and what an idle-but-awake compute sits
    // at. Real traffic pushes it higher; this is the scheduled portion.
    cuHoursPerMonth: Number(((awakeMinutesPerDay / 60) * 0.25 * 30).toFixed(1)),
    wakeEventsPerDay: fires.size,
    invocationsPerDay: invocations,
    alwaysOn,
  };
}
