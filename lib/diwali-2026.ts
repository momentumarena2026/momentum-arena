/**
 * Diwali Bumper 2026 — the dates, in one place.
 *
 * Two independent things key off these and they must not drift:
 *
 *   the COUPON   `scripts/seed-diwali-coupon.ts` writes DISCOUNT_FROM /
 *                DISCOUNT_TO into the coupon's BOOKING_DATE condition,
 *                which decides which PLAY dates get the flat rate.
 *   the PUSH     `scripts/seed-diwali-push.ts` writes one single-day
 *                `DailyPushOccasion` per PUSH day, which decides which
 *                evening each line is allowed to run.
 *
 * The push copy quotes a rupee figure out loud. That is only true while
 * the coupon says it is, so the two windows are derived from the same
 * constants rather than from somebody remembering — the same discipline
 * `lib/navratri-2026.ts` installed for the 25% run.
 *
 * ── THE TWO WINDOWS ARE DELIBERATELY DIFFERENT LENGTHS ────────────────
 * The discount covers 1–11 Nov. The pushes start a day EARLIER, on 31
 * Oct, because the venue asked for the campaign to open the evening
 * before. That teaser day is the one place where the offer is quoted
 * while it is not yet live, so its line must promise TOMORROW, never
 * today — `tests/diwali-2026.test.ts` asserts exactly that, because a
 * "₹1500 aaj" push on the 31st is a screenshot the counter has to
 * honour a day early.
 *
 * Dates verified against published panchang rather than recalled:
 * Diwali (Lakshmi Puja) falls on Sunday 8 Nov 2026, with the five days
 * running Dhanteras Fri 6 Nov → Bhai Dooj Wed 11 Nov. The venue's
 * window opens a week ahead of Dhanteras and closes on Bhai Dooj, so
 * the copy below is sequenced against those days. These are lunar and
 * move every year: a later Diwali needs a new module, not an edit to
 * this one.
 */

/** First PLAY date the flat rate applies to, IST calendar date. */
export const DIWALI_DISCOUNT_FROM = "2026-11-01";

/** Last PLAY date, IST calendar date, inclusive — Bhai Dooj. */
export const DIWALI_DISCOUNT_TO = "2026-11-11";

/**
 * The flat per-slot rate, in WHOLE RUPEES.
 *
 * Quoted in the push copy and used by the coupon seed, so the number
 * lives here once. Both sports' full turf is otherwise ₹2000 at peak
 * (17:00–26:00) and ₹1600 off-peak, which is what makes "one price"
 * the whole point of the offer: it flattens the two bands.
 */
export const DIWALI_FLAT_RATE = 1500;

/**
 * First PUSH day — the teaser, one day before the discount opens.
 * Shorthand `d0`, so that `dN` lines up with the Nth day of the offer.
 */
export const DIWALI_PUSH_FROM = "2026-10-31";

/** Last PUSH day — the final evening of the offer. */
export const DIWALI_PUSH_TO = DIWALI_DISCOUNT_TO;

/** How many days the discount runs. Asserted against the dates by the tests. */
export const DIWALI_DISCOUNT_DAYS = 11;

/** How many days the push campaign runs: the teaser plus the eleven. */
export const DIWALI_PUSH_DAYS = DIWALI_DISCOUNT_DAYS + 1;

/**
 * One tag per DAY — `diwali-d0` … `diwali-d11` — rather than a single
 * `diwali` tag across the run.
 *
 * ── WHY, BECAUSE THE OBVIOUS DESIGN IS WRONG ──────────────────────────
 * One tag and one twelve-day window does produce twelve different
 * lines: a dated occasion sets the everyday pool aside, and
 * least-recently-used then walks them without repeating. That part
 * works.
 *
 * What it cannot do is decide WHICH line lands on WHICH day, because
 * LRU breaks ties on `id` and `id` is a cuid. The Navratri run proved
 * what that costs: the first replay put "aaj aakhri din" on day one.
 *
 * Here the ordering carries more than a countdown. The teaser must land
 * on the 31st and nowhere else; "diwali mubarak" must land on the 8th
 * and would be strange on the 2nd; and the last two days count down.
 * Twelve single-day windows make each day's line arithmetic rather than
 * tie-break luck, using the same engine with no change to it.
 *
 * NOTE: do NOT also create a bare `diwali` window. Three legacy lines
 * in the library carry that tag; a window for it would put them in the
 * same topical pool and the day-by-day sequencing would go back to
 * being a coin toss. The seeder's replay reads windows from the
 * database and asserts the expected tag wins each day, so this fails
 * loudly rather than quietly if anyone adds one.
 */
export function diwaliDayTag(day: number): string {
  return `diwali-d${day}`;
}

/** Every push-day tag, in order: d0 (teaser) through d11. */
export const DIWALI_DAY_TAGS = Array.from(
  { length: DIWALI_PUSH_DAYS },
  (_, i) => diwaliDayTag(i),
);

/** The teaser tag, called out by name because it is the one that may not claim "today". */
export const DIWALI_TEASER_TAG = diwaliDayTag(0);

/**
 * Walk IST calendar dates from `from` to `to`, inclusive, as "YYYY-MM-DD".
 *
 * Built by walking UTC midnights, which is safe here because these are
 * bare calendar dates with no instant attached — the IST-vs-UTC trap
 * (gotchas 19 and 21) bites when a date meets a timestamp column or a
 * `new Date()` parse, and neither happens on this path.
 */
function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (
    let d = new Date(`${from}T00:00:00.000Z`);
    d.toISOString().slice(0, 10) <= to;
    d = new Date(d.getTime() + 86400_000)
  ) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** The eleven PLAY dates the discount covers. */
export function diwaliDiscountDates(): string[] {
  return datesBetween(DIWALI_DISCOUNT_FROM, DIWALI_DISCOUNT_TO);
}

/** The twelve PUSH dates, teaser first. Index N is the `diwali-dN` day. */
export function diwaliPushDates(): string[] {
  return datesBetween(DIWALI_PUSH_FROM, DIWALI_PUSH_TO);
}
