import { getAllSlotHoursLive } from "@/lib/court-config";

/**
 * Why an hours list cannot be held — or null.
 *
 * The lock endpoints took `JSON.parse(body.hours)` straight into the lock
 * path with NO validation of any kind: not a length, not a range, not a type.
 * Every other field on that request is checked.
 *
 * The bound is the arena's OWN configured day, read live, rather than a
 * constant. The first version of this guard hardcoded 24, which happens to
 * fit today's 5am–2am (hours 5..25, twenty-one of them) and would have
 * refused a legitimate booking the moment the venue opened earlier — a guard
 * that turns away real customers is worse than the hole it closes. Asking the
 * settings makes the rule true by construction: you may ask for hours the
 * arena actually sells, once each, and no more of them than it has.
 *
 * Both lock routes — web and mobile — call THIS. They had a copy each, which
 * is how two rules become two different rules.
 */
export async function badHours(hours: unknown): Promise<string | null> {
  if (!Array.isArray(hours) || hours.length === 0) return "Invalid data";
  if (!hours.every((h) => Number.isInteger(h))) return "Invalid data";
  if (new Set(hours).size !== hours.length) return "Invalid data";

  const open = await getAllSlotHoursLive();
  if (hours.length > open.length) {
    return "That's more hours than the arena's day.";
  }
  // A late-night hour is stored as 24/25/26 — the small hours of the NEXT
  // day — so the open list is the only thing that knows which are real.
  if (!hours.every((h) => open.includes(h))) {
    return "The arena isn't open for one of those hours.";
  }
  return null;
}
