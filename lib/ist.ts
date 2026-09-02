/**
 * IST calendar arithmetic that does not ask the host what timezone it is.
 *
 * The venue is in Mathura and every figure an admin reads — a day's
 * takings, a peak hour, a month's revenue — is an IST figure. But JS
 * date getters (`getMonth()`, `getHours()`, `getDay()`) and the bare
 * string constructor (`new Date("2026-09-01T00:00:00")`) all read the
 * HOST's timezone. On Vercel that is UTC; on a developer's Mac it is
 * IST. So the same code returned different months in production and in
 * development, and nothing said so.
 *
 * Why it bit: the arena runs to 1am, and 48 cafe orders worth ₹13,075 —
 * 45% of all cafe revenue — are placed between midnight and 5:30am IST.
 * Every one of those instants falls in the PREVIOUS UTC day. The moment
 * one landed on the 1st of a month, the Cafe tab (host-local) and the
 * Overall P&L (IST, via a SQL `+ interval '330 minutes'`) would have
 * reported the same sale in different months. Found 2026-09-02, before
 * it happened, purely by luck.
 *
 * The trick used throughout: shift the instant by +5:30, then read UTC
 * getters. The shifted clock's UTC fields ARE the IST calendar fields.
 * This mirrors what the SQL side already does with `+ interval '330
 * minutes'`, so the TypeScript and SQL paths agree by construction.
 *
 * India has no DST and has held UTC+5:30 since 1945, so a fixed offset
 * is correct here in a way it would not be for most timezones.
 */

export const IST_OFFSET_MS = 330 * 60 * 1000;

/** Same instant, shifted so `getUTC*()` reads IST calendar fields. */
export function toIst(d: Date): Date {
  return new Date(d.getTime() + IST_OFFSET_MS);
}

/** "2026-09-01" — the IST calendar day this instant falls on. */
export function istDateKey(d: Date): string {
  return toIst(d).toISOString().slice(0, 10);
}

/** "2026-09" — the IST calendar month this instant falls on. */
export function istMonthKey(d: Date): string {
  return toIst(d).toISOString().slice(0, 7);
}

/** 0-23, the IST hour. An order at 00:30 IST is hour 0, not 19. */
export function istHour(d: Date): number {
  return toIst(d).getUTCHours();
}

/** 0-6 (Sunday = 0), the IST weekday. */
export function istWeekday(d: Date): number {
  return toIst(d).getUTCDay();
}

/**
 * The UTC instants bounding a range of IST calendar days, inclusive.
 * IST midnight is 18:30 UTC on the previous day, hence the subtraction.
 */
export function istRangeBounds(
  dateFrom: string,
  dateTo: string,
): { from: Date; to: Date } {
  return {
    from: new Date(Date.parse(`${dateFrom}T00:00:00.000Z`) - IST_OFFSET_MS),
    to: new Date(Date.parse(`${dateTo}T23:59:59.999Z`) - IST_OFFSET_MS),
  };
}

/** The UTC instants bounding an IST calendar year, inclusive. */
export function istYearBounds(year: number): { from: Date; to: Date } {
  return {
    from: new Date(Date.UTC(year, 0, 1) - IST_OFFSET_MS),
    to: new Date(Date.UTC(year + 1, 0, 1) - IST_OFFSET_MS - 1),
  };
}

/** IST Monday anchoring the week this instant falls in, as "YYYY-MM-DD". */
export function istWeekStartKey(d: Date): string {
  const ist = toIst(d);
  const day = ist.getUTCDay();
  ist.setUTCDate(ist.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return ist.toISOString().slice(0, 10);
}
