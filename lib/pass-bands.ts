/**
 * Pass pricing bands — the (dayType × timeType) pricing cells a pass may
 * be redeemed on. A pass is bound to one PRICE tier: every band it
 * carries shared the same per-slot price at creation, and that price is
 * the pass's anchor. Pure helpers only (no db) so both client wizard and
 * server redemption can import them.
 */

export type DayType = "WEEKDAY" | "WEEKEND";
export type TimeType = "PEAK" | "OFF_PEAK";
export interface Band {
  dayType: DayType;
  timeType: TimeType;
}

export const bandKey = (b: Band): string => `${b.dayType}-${b.timeType}`;

const DAY_LABEL: Record<DayType, string> = {
  WEEKDAY: "Weekday",
  WEEKEND: "Weekend",
};
const TIME_LABEL: Record<TimeType, string> = {
  PEAK: "Peak",
  OFF_PEAK: "Off-peak",
};

export const bandLabel = (b: Band): string =>
  `${DAY_LABEL[b.dayType]} · ${TIME_LABEL[b.timeType]}`;

/** Parse a stored bands JSON value into a clean Band[] (defensive:
 *  tolerates null / legacy / malformed values → empty array). */
export function parseBands(value: unknown): Band[] {
  if (!Array.isArray(value)) return [];
  const out: Band[] = [];
  for (const raw of value) {
    if (
      raw &&
      typeof raw === "object" &&
      "dayType" in raw &&
      "timeType" in raw &&
      (raw.dayType === "WEEKDAY" || raw.dayType === "WEEKEND") &&
      (raw.timeType === "PEAK" || raw.timeType === "OFF_PEAK")
    ) {
      out.push({ dayType: raw.dayType, timeType: raw.timeType });
    }
  }
  return out;
}

/** Does a slot's (dayType,timeType) fall inside the pass's bands?
 *  An empty band list means "unrestricted" — legacy all-hours passes
 *  (bought before bands existed) cover everything. */
export function slotInBands(
  bands: Band[],
  slot: { dayType: string; timeType: string },
): boolean {
  if (bands.length === 0) return true;
  return bands.some(
    (b) => b.dayType === slot.dayType && b.timeType === slot.timeType,
  );
}

/** Compact human summary of a band set for cards / tables. */
export function bandsSummary(bands: Band[]): string {
  if (bands.length === 0) return "All hours";
  const days = new Set(bands.map((b) => b.dayType));
  const times = new Set(bands.map((b) => b.timeType));
  // Common shapes get a tidy label; otherwise list the cells.
  if (times.size === 1) {
    const t = TIME_LABEL[[...times][0] as TimeType];
    if (days.size === 2) return `${t} · all week`;
    return `${t} · ${DAY_LABEL[[...days][0] as DayType]}`;
  }
  if (days.size === 1 && times.size === 2) {
    return `${DAY_LABEL[[...days][0] as DayType]} · all day`;
  }
  return bands.map(bandLabel).join(", ");
}
