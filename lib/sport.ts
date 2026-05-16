import { Sport } from "@prisma/client";

export { Sport };

const SPORT_VALUES = Object.values(Sport) as Sport[];

/**
 * Parse a URL slug or enum string (e.g. `"pickleball"`, `"PICKLEBALL"`) into a
 * {@link Sport}. Returns `null` when the value is not a known sport.
 */
export function parseSport(value: string): Sport | null {
  const normalized = value.trim().toUpperCase();
  return SPORT_VALUES.includes(normalized as Sport)
    ? (normalized as Sport)
    : null;
}

/** Coerce a route param or enum value to {@link Sport}, or `null` if invalid. */
export function normalizeSport(sport: Sport | string): Sport | null {
  return typeof sport === "string" ? parseSport(sport) : sport;
}

/** True when `sport` resolves to the given {@link Sport} enum member. */
export function isSport(sport: Sport | string, target: Sport): boolean {
  return normalizeSport(sport) === target;
}

export function isPickleball(sport: Sport | string): boolean {
  return isSport(sport, Sport.PICKLEBALL);
}

export function isCricket(sport: Sport | string): boolean {
  return isSport(sport, Sport.CRICKET);
}

export function isFootball(sport: Sport | string): boolean {
  return isSport(sport, Sport.FOOTBALL);
}
