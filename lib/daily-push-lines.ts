/**
 * Choosing what the daily push actually says.
 *
 * Pure, like lib/daily-push-rules.ts, and for the same reason: the
 * engine, the admin dry run and the tests must all agree on which line
 * goes out today, and a choice made inside a database sweep is a choice
 * nobody can check.
 *
 * ── THE SHAPE OF THE DECISION ─────────────────────────────────────────
 * Two steps, and they are worth keeping separate.
 *
 *   OCCASIONS  What kind of day is it? Some of that is computable —
 *              the weekday, the season — and some is not: Holi and
 *              Janmashtami are lunar, and there is no cricket fixtures
 *              feed here, so those arrive as dated windows the venue
 *              maintains.
 *
 *   SELECTION  Of the lines allowed to run today, which one? Topical
 *              beats generic, then least-recently-used, so the pool
 *              cycles rather than shuffles and nothing repeats until
 *              everything has had a turn.
 * ──────────────────────────────────────────────────────────────────────
 */

/** A tag that marks a line as CLAIMING the evening has space. */
export const NEEDS_SLOTS = "needs-slots";

export const WEEKDAY_TAGS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

/**
 * Seasons as Mathura actually experiences them, by IST month.
 *
 * Coarse on purpose. The point of a season tag is that the copy can
 * mention the weather without being wrong — "it rained, the turf
 * drains" in August is safe, in April it is nonsense — and month
 * boundaries are accurate enough for that. Anything finer would need a
 * weather feed, which is a dependency this does not earn.
 */
export function seasonTag(istMonth: number): string {
  if (istMonth >= 6 && istMonth <= 8) return "monsoon"; // Jul–Sep
  if (istMonth >= 11 || istMonth <= 1) return "winter"; // Dec–Feb
  if (istMonth >= 3 && istMonth <= 5) return "summer"; // Apr–Jun
  return "pleasant"; // Mar, Oct–Nov
}

export interface OccasionWindow {
  tag: string;
  label: string;
  /** Inclusive IST calendar dates, midnight-anchored (istDayKey shape). */
  startsOn: Date;
  endsOn: Date;
}

/**
 * Every tag that is true today.
 *
 * `istDate` must be the IST calendar date as a UTC-midnight instant —
 * i.e. what `istDayKey` returns. Passing an instant instead is gotcha
 * 19 all over again, so the comparison below is done on the date part
 * rather than on getTime().
 */
export function occasionsFor(istDate: Date, windows: OccasionWindow[]): string[] {
  const tags = new Set<string>();
  tags.add(WEEKDAY_TAGS[istDate.getUTCDay()]);
  tags.add(seasonTag(istDate.getUTCMonth()));
  // Weekend is worth its own tag: a line can be about Saturday-ness
  // without being written twice.
  const dow = istDate.getUTCDay();
  if (dow === 0 || dow === 6) tags.add("weekend");
  else tags.add("weekday");

  const day = istDate.toISOString().slice(0, 10);
  for (const w of windows) {
    const from = w.startsOn.toISOString().slice(0, 10);
    const to = w.endsOn.toISOString().slice(0, 10);
    if (day >= from && day <= to) tags.add(w.tag);
  }
  return [...tags];
}

export interface LineCandidate {
  id: string;
  title: string;
  body: string;
  tags: string[];
  enabled: boolean;
  lastUsedAt: Date | null;
}

export interface LineContext {
  /** Everything true about today — from `occasionsFor`. */
  occasions: string[];
  /** Whether the evening genuinely has space, for `needs-slots` lines. */
  slotsAreFree: boolean;
}

/**
 * Can this line run today at all?
 *
 * Note the asymmetry between the two kinds of tag, which is the whole
 * reason they share a column but not a meaning:
 *
 *   needs-slots   a HARD gate. False availability is the one failure
 *                 that makes the product lie, so the line is out.
 *   occasion      a SOFT filter. A line tagged for an occasion may only
 *                 run on that occasion, but an untagged line may run
 *                 any day — otherwise the pool would be empty on an
 *                 ordinary Tuesday.
 */
export function lineIsEligible(line: LineCandidate, ctx: LineContext): boolean {
  if (!line.enabled) return false;

  const occasionTags = line.tags.filter((t) => t !== NEEDS_SLOTS);
  if (line.tags.includes(NEEDS_SLOTS) && !ctx.slotsAreFree) return false;

  // Untagged lines are the everyday pool and always qualify.
  if (occasionTags.length === 0) return true;
  // A tagged line needs at least one of its occasions to be true now.
  return occasionTags.some((t) => ctx.occasions.includes(t));
}

/**
 * Today's line, or null if the library has nothing to say.
 *
 * Topical first: if any eligible line carries an occasion tag, the
 * generic pool is set aside entirely. That is what stops a Holi line
 * losing a coin toss to "monday, the turf isn't judging" on the one day
 * of the year it lands.
 *
 * Then least-recently-used, nulls first. Not random: random repeats
 * within a week on a pool of ninety and the venue would swear the
 * rotation was broken. LRU cycles the whole library before anything
 * comes round again.
 *
 * `tieBreak` keeps it deterministic for tests; production passes the
 * id, which is stable and arbitrary — good enough, and it means two
 * runs on the same day cannot disagree.
 */
export function pickLine(
  lines: LineCandidate[],
  ctx: LineContext,
): LineCandidate | null {
  const eligible = lines.filter((l) => lineIsEligible(l, ctx));
  if (eligible.length === 0) return null;

  const topical = eligible.filter((l) =>
    l.tags.some((t) => t !== NEEDS_SLOTS && ctx.occasions.includes(t)),
  );
  const pool = topical.length > 0 ? topical : eligible;

  return [...pool].sort((a, b) => {
    const at = a.lastUsedAt?.getTime() ?? -1;
    const bt = b.lastUsedAt?.getTime() ?? -1;
    if (at !== bt) return at - bt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  })[0];
}

/** Why the library cannot speak today — for the admin, not the customer. */
export function libraryRefusal(
  lines: LineCandidate[],
  ctx: LineContext,
): string | null {
  if (lines.length === 0) return "The line library is empty.";
  if (lines.every((l) => !l.enabled)) return "Every line in the library is switched off.";
  if (pickLine(lines, ctx) === null) {
    return "No line is eligible today — every enabled line is tagged for an occasion that is not running, or claims free slots on a full evening.";
  }
  return null;
}
