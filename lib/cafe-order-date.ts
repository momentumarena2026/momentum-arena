import { istNoonUtc } from "@/lib/ist";

/**
 * Resolve the admin-chosen order date into the instant to stamp.
 *
 * The admin picks a bare calendar day; the columns want a timestamp.
 * Two things make that conversion worth its own function:
 *
 *  - It must land on the chosen day *in IST*. `new Date("2026-11-10")`
 *    is midnight UTC, which is 05:30 IST — right day by luck, and the
 *    wrong one the moment anybody shifts it. See lib/ist.ts for the
 *    incident this rule comes from.
 *  - Today must stay exactly as it was. When the chosen day IS today we
 *    return the real clock, so an ordinary counter sale keeps its true
 *    minute and the hour-of-day chart stays honest. Only a date the
 *    admin deliberately moved gets the synthetic midday stamp.
 */
export function resolveOrderDate(
  raw: string | undefined,
  todayKey: string,
):
  | { ok: true; dateKey: string; at: Date; isToday: boolean }
  | { ok: false; error: string } {
  const key = raw?.trim();
  if (!key) return { ok: true, dateKey: todayKey, at: new Date(), isToday: true };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    return { ok: false, error: "Order date must look like 2026-11-10" };
  }
  // Round-trip guard. Date.parse accepts "2026-02-31" and quietly rolls
  // it to 3 March, which would file the sale on a day nobody chose.
  const parsed = new Date(`${key}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== key) {
    return { ok: false, error: `${key} is not a real date` };
  }
  // Not a policy on how far back or forward a sale may be dated — the
  // admin is trusted on that. This only catches the date field emitting
  // a four-digit year from a mistyped keystroke (0202, 20226).
  const year = Number(key.slice(0, 4));
  if (year < 2020 || year > 2100) {
    return { ok: false, error: `Check the year on ${key}` };
  }

  const isToday = key === todayKey;
  return { ok: true, dateKey: key, at: isToday ? new Date() : istNoonUtc(key), isToday };
}

