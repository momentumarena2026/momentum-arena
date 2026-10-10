/**
 * Shardiya Navratri 2026 — the nine days, in one place.
 *
 * Two independent things key off these dates and they must not drift:
 *
 *   the COUPON   `scripts/seed-navratri-coupon.ts` writes them into
 *                NAVRATRI25's BOOKING_DATE condition, which decides
 *                which PLAY dates get 25% off.
 *   the PUSH     `scripts/seed-navratri-push.ts` writes them into the
 *                `navratri` DailyPushOccasion window, which decides
 *                which days the nine festival lines may run.
 *
 * The push copy says "25% off" out loud. That is only true while the
 * coupon says it is, so a push window wider than the coupon window
 * would advertise a discount the checkout then refuses — the exact
 * failure the daily-push library's no-prices rule exists to prevent.
 * Sharing the constants makes the two windows identical by
 * construction rather than by somebody remembering.
 *
 * Verified against published panchang rather than recalled:
 * Ghatasthapana Sun 11 Oct, ninth day Mon 19 Oct. Vijayadashami falls
 * on Tue 20 Oct and is NOT included — the venue asked for the nine
 * days. These are lunar and move every year; a later festival needs a
 * new module, not an edit to this one.
 */

/** First day, IST calendar date. */
export const NAVRATRI_FROM = "2026-10-11";

/** Ninth day, IST calendar date, inclusive. */
export const NAVRATRI_TO = "2026-10-19";

/**
 * One tag per DAY — `navratri-d1` … `navratri-d9` — rather than a single
 * `navratri` tag across all nine.
 *
 * ── WHY, BECAUSE THE OBVIOUS DESIGN IS WRONG ──────────────────────────
 * One tag and one nine-day window does produce nine different lines: a
 * dated occasion sets the everyday pool aside, and least-recently-used
 * then walks the nine without repeating. That part works.
 *
 * What it cannot do is decide WHICH line lands on WHICH day. LRU breaks
 * ties on `id`, which is a cuid — so the order is arbitrary, and the
 * first replay of this put "aaj aakhri din" (the last-day line) on day
 * one and the opening line on day seven.
 *
 * That is fatal to the copy, not cosmetic. Three of the nine count down
 * — "teen din aur", "kal tak hai", "aaj aakhri din" — and a countdown
 * delivered out of order is worse than no countdown. Nine single-day
 * windows make each day's line a matter of arithmetic instead of
 * tie-break luck, using the same machinery with no engine change.
 *
 * The trade: disable one line and that day falls back to the everyday
 * pool rather than to another festival line. That is the honest
 * degradation — the seeder's replay prints it, so it is visible.
 */
export function navratriDayTag(day: number): string {
  return `navratri-d${day}`;
}

/** Every day tag, in order. */
export const NAVRATRI_DAY_TAGS = Array.from({ length: 9 }, (_, i) => navratriDayTag(i + 1));

/** How many days the festival spans. Asserted against the copy by the seeder. */
export const NAVRATRI_DAYS = 9;

/**
 * The nine IST calendar dates, as "YYYY-MM-DD".
 *
 * Built by walking UTC midnights, which is safe here because these are
 * bare calendar dates with no instant attached — the IST-vs-UTC trap
 * (gotchas 19 and 21) applies when a date meets a timestamp column or a
 * `new Date()` parse, and neither happens on this path.
 */
export function navratriDates(): string[] {
  const out: string[] = [];
  for (
    let d = new Date(`${NAVRATRI_FROM}T00:00:00.000Z`);
    d.toISOString().slice(0, 10) <= NAVRATRI_TO;
    d = new Date(d.getTime() + 86400_000)
  ) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
