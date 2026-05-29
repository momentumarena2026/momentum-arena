import { CourtZone, ConfigSize, Sport } from "@prisma/client";

export interface CourtConfigDef {
  sport: Sport;
  size: ConfigSize;
  label: string;
  position: string;
  widthFt: number;
  lengthFt: number;
  zones: CourtZone[];
}

// All bookable court configurations
export const COURT_CONFIGS: CourtConfigDef[] = [
  // Cricket — all sizes
  {
    sport: "CRICKET",
    size: "XS",
    label: "Leather Pitch 1",
    position: "LP1",
    widthFt: 10,
    lengthFt: 90,
    zones: ["LEATHER_1"],
  },
  {
    sport: "CRICKET",
    size: "XS",
    label: "Leather Pitch 2",
    position: "LP2",
    widthFt: 10,
    lengthFt: 90,
    zones: ["LEATHER_2"],
  },
  {
    sport: "CRICKET",
    size: "MEDIUM",
    label: "Medium (Left Half)",
    position: "LEFT",
    widthFt: 40,
    lengthFt: 90,
    zones: ["LEATHER_1", "BOX_A"],
  },
  {
    sport: "CRICKET",
    size: "MEDIUM",
    label: "Medium (Right Half)",
    position: "RIGHT",
    widthFt: 40,
    lengthFt: 90,
    zones: ["BOX_B", "LEATHER_2"],
  },
  {
    sport: "CRICKET",
    size: "LARGE",
    label: "Large (Center)",
    position: "CENTER",
    widthFt: 60,
    lengthFt: 90,
    zones: ["BOX_A", "BOX_B"],
  },
  {
    sport: "CRICKET",
    size: "FULL",
    label: "Full Field",
    position: "FULL",
    widthFt: 80,
    lengthFt: 90,
    zones: ["LEATHER_1", "BOX_A", "BOX_B", "LEATHER_2"],
  },
  // Football — full field only
  {
    sport: "FOOTBALL",
    size: "FULL",
    label: "Full Field",
    position: "FULL",
    widthFt: 80,
    lengthFt: 90,
    zones: ["LEATHER_1", "BOX_A", "BOX_B", "LEATHER_2"],
  },
  // Pickleball — shared court
  {
    sport: "PICKLEBALL",
    size: "SHARED",
    label: "Pickleball Court",
    position: "SHARED",
    widthFt: 20,
    lengthFt: 44,
    zones: ["SHARED_COURT"],
  },
];

// Operating hours: 5 AM to 1 AM (hour 5 through 24, where 24 = midnight-1AM)
export const OPERATING_HOURS = {
  start: 5,
  end: 25, // exclusive — last slot starts at hour 24 (12 AM)
};

export const SLOT_DURATION_HOURS = 1;
export const LOCK_TTL_MINUTES = 5;

// Check if two zone arrays overlap
export function zonesOverlap(a: CourtZone[], b: CourtZone[]): boolean {
  return a.some((zone) => b.includes(zone));
}

// Get all hours as an array
export function getAllSlotHours(): number[] {
  const hours: number[] = [];
  for (let h = OPERATING_HOURS.start; h < OPERATING_HOURS.end; h++) {
    hours.push(h);
  }
  return hours;
}

// Format hour for display (e.g., 5 → "5:00 AM", 13 → "1:00 PM", 24 → "12:00 AM")
export function formatHour(hour: number): string {
  const h = hour % 24;
  if (h === 0) return "12:00 AM";
  if (h === 12) return "12:00 PM";
  if (h < 12) return `${h}:00 AM`;
  return `${h - 12}:00 PM`;
}

// Format hour range (e.g., 5 → "5:00 AM - 6:00 AM")
export function formatHourRange(startHour: number): string {
  return `${formatHour(startHour)} - ${formatHour(startHour + 1)}`;
}

// Compact hour format (e.g., 5 → "5am", 17 → "5pm", 12 → "12pm", 24 → "12am")
export function formatHourCompact(hour: number): string {
  const h = hour % 24;
  if (h === 0) return "12am";
  if (h === 12) return "12pm";
  if (h < 12) return `${h}am`;
  return `${h - 12}pm`;
}

// Compact hour range (e.g., 17 → "5pm - 6pm")
export function formatHourRangeCompact(startHour: number): string {
  return `${formatHourCompact(startHour)} - ${formatHourCompact(startHour + 1)}`;
}

// Merge consecutive sorted hours into compact ranges.
// e.g. [17, 18, 19, 22] → "5pm - 8pm, 10pm - 11pm"
export function formatHoursAsRanges(hours: number[]): string {
  if (hours.length === 0) return "";
  const sorted = [...hours].sort((a, b) => a - b);
  const groups: [number, number][] = [];
  let start = sorted[0];
  let end = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end + 1) {
      end = sorted[i];
    } else {
      groups.push([start, end]);
      start = sorted[i];
      end = sorted[i];
    }
  }
  groups.push([start, end]);
  return groups
    .map(([s, e]) => `${formatHourCompact(s)} - ${formatHourCompact(e + 1)}`)
    .join(", ");
}

// "5:30pm" / "5pm" — omits :00 minutes so hourly slots stay terse.
// Exported so half-hour-aware UIs (bowling-machine slot picker,
// notification senders, calendar cell labels) can format any
// minute-of-day without re-implementing the AM/PM math.
export function formatHourMinuteCompact(totalMinutes: number): string {
  const h24 = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  const ampm = h24 < 12 ? "am" : "pm";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${m.toString().padStart(2, "0")}${ampm}`;
}

// Slot-aware range formatter that respects half-hour startMinutes
// + per-slot durationMinutes (bowling-machine = 30, everything
// else = 60). Consecutive slots whose end aligns with the next
// start are merged into a single range, so a customer who picked
// 4:30pm + 5:00pm 30-min slots sees "4:30pm - 5:30pm" instead of
// the two ranges rendered separately.
//
// Falls back to startMinute=0 / duration=60 for legacy callers
// that only pass `startHour`, which keeps the old behaviour intact
// for hourly cricket/football bookings booked before Phase 1 of
// the bowling-machine work.
export function formatSlotsAsRanges(
  slots: Array<{
    startHour: number;
    startMinute?: number | null;
    durationMinutes?: number | null;
  }>,
): string {
  if (slots.length === 0) return "";
  const ranges: [number, number][] = slots
    .map((s) => {
      const startTotal = s.startHour * 60 + (s.startMinute ?? 0);
      const duration = s.durationMinutes ?? 60;
      return [startTotal, startTotal + duration] as [number, number];
    })
    .sort((a, b) => a[0] - b[0]);

  const merged: [number, number][] = [];
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1];
    if (last && last[1] === start) {
      last[1] = end;
    } else {
      merged.push([start, end]);
    }
  }
  return merged
    .map(([s, e]) => `${formatHourMinuteCompact(s)} - ${formatHourMinuteCompact(e)}`)
    .join(", ");
}

/**
 * Customer-facing court label.
 *
 * The admin panel always shows the concrete courtConfig label (e.g.,
 * "Medium (Left Half)"). Customer-facing screens call this helper so that
 * bookings created via the unified half-court flow display a neutral
 * "Half Court (40×90)" label — the physical side is assigned at the venue.
 * Older bookings without the flag (defaults to false) keep their original
 * concrete label.
 */
export function customerFacingCourtLabel(
  courtConfigLabel: string,
  wasBookedAsHalfCourt: boolean
): string {
  return wasBookedAsHalfCourt ? "Half Court (40×90)" : courtConfigLabel;
}

// Check if a date is a weekend (Saturday or Sunday)
export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

// Get sport display info
export const SPORT_INFO: Record<
  Sport,
  { name: string; icon: string; color: string; description: string }
> = {
  CRICKET: {
    name: "Cricket",
    icon: "cricket",
    color: "emerald",
    description: "Box cricket with multiple pitch configurations",
  },
  FOOTBALL: {
    name: "Football",
    icon: "football",
    color: "blue",
    description: "Indoor football with flexible field sizes",
  },
  PICKLEBALL: {
    name: "Pickleball",
    icon: "pickleball",
    color: "yellow",
    description: "Shared court with professional markings",
  },
};

/**
 * Render a friendly one-line label for a config that's BLOCKING a
 * slot — used in the slot-grid amber state to tell the customer
 * what's actually taken. Reads category first (so a Bowling
 * Machine blocker says "Bowling busy" regardless of size/position)
 * then falls back to size+position for the box-cricket configs.
 *
 * Pure function — shared between server (lib/availability.ts) and
 * client (slot-grid components) so wording stays in sync.
 */
export function blockerShortLabel(b: {
  size: string;
  position: string;
  category: string | null;
}): string {
  if (b.category === "BOWLING_MACHINE") return "Bowling busy";
  if (b.size === "FULL") return "Full court booked";
  if (b.size === "LARGE") return "Center area booked";
  if (b.size === "MEDIUM") {
    if (b.position === "LEFT") return "Left half booked";
    if (b.position === "RIGHT") return "Right half booked";
    return "Half court booked";
  }
  if (b.size === "XS") {
    if (b.position === "LP1") return "Left leather corner booked";
    if (b.position === "LP2") return "Right leather corner booked";
    return "Leather corner booked";
  }
  return "Booked";
}

/**
 * Subtitle on each row of the alternatives sheet — kept generic
 * by SIZE only (no left/right). The venue assigns the actual
 * physical side at game time, so surfacing "Right half" to the
 * customer is both noise and a small commitment we don't need to
 * make. Categories like Bowling Machine stay distinct.
 */
export function alternativeShortLabel(a: {
  size: string;
  position: string;
  category: string | null;
}): string {
  if (a.category === "BOWLING_MACHINE") return "Bowling machine free";
  if (a.size === "FULL") return "Full court free";
  if (a.size === "LARGE") return "Center area free";
  if (a.size === "MEDIUM") return "Half court free";
  if (a.size === "XS") return "Leather corner free";
  return "Available";
}

/**
 * Bold CTA copy on each alternatives-sheet row. Action-oriented +
 * generic by SIZE so the row reads as a clear next step rather
 * than a config name. Replaces the previous direct use of
 * `CourtConfig.label`, which leaked the DB-side "Medium (Right
 * Half)" wording into the customer flow.
 */
export function alternativeActionLabel(a: {
  size: string;
  position: string;
  category: string | null;
}): string {
  if (a.category === "BOWLING_MACHINE") return "Book bowling machine";
  if (a.size === "FULL") return "Book full court";
  if (a.size === "LARGE") return "Book center area";
  if (a.size === "MEDIUM") return "Book half court";
  if (a.size === "XS") return "Book leather corner";
  return "Book this option";
}

/**
 * Compose a one-liner tag for the tile from an array of blockers.
 * Used on the RED (hard-blocked / notify-me) tile because the
 * customer can't pivot away there — telling them exactly what's
 * full ("Full court booked · Notify me") is the useful signal.
 */
export function summarizeBlockers(
  blockers: Array<{ size: string; position: string; category: string | null }>,
): string {
  if (blockers.length === 0) return "Booked";
  const uniq = new Set(blockers.map(blockerShortLabel));
  if (uniq.size === 1) return Array.from(uniq)[0];
  return "Multiple bookings";
}

/**
 * Positive-framed tag for the AMBER (soft-blocked / "Tap for
 * alternatives") tile. Derived from what's STILL bookable in the
 * sibling alternatives, not from the blocker — so a customer
 * sees "Half Available" whether the trigger was a half-court
 * booking or the bowling machine taking the leather corner.
 *
 * Picked label tracks the biggest equivalent option still free,
 * so the user reads what they're most likely to pivot to:
 *   - Some FULL still free   → "Full Court Available"
 *   - Some MEDIUM still free → "Half Available"      (the
 *                              common cricket Full → Half pivot)
 *   - LARGE only             → "Center Available"
 *   - XS only                → "Corner Available"
 *
 * Caller must only invoke when alternatives.length > 0; the
 * empty case ("Booked") is handled by the red-tile path.
 */
export function summarizeAvailability(
  alternatives: Array<{ size: string; position: string; category: string | null }>,
): string {
  if (alternatives.length === 0) return "Booked";
  if (alternatives.some((a) => a.size === "FULL")) return "Full Court Available";
  if (alternatives.some((a) => a.size === "MEDIUM")) return "Half Available";
  if (alternatives.some((a) => a.size === "LARGE")) return "Center Available";
  if (alternatives.some((a) => a.size === "XS")) return "Corner Available";
  return "Alternative Available";
}

// Size display info
export const SIZE_INFO: Record<
  ConfigSize,
  { name: string; description: string }
> = {
  XS: { name: "Small (Leather ball practice.)", description: "Leather pitch (10ft x 90ft)" },
  SMALL: { name: "Small (Leather ball practice.)", description: "Single box lane (30ft x 90ft)" },
  MEDIUM: {
    name: "Half Field",
    description: "Box lane + leather pitch (40ft x 90ft)",
  },
  LARGE: {
    name: "Large",
    description: "Two box lanes, center field (60ft x 90ft)",
  },
  XL: {
    name: "Extra Large",
    description: "Two box lanes + leather pitch (70ft x 90ft)",
  },
  FULL: { name: "Full Field", description: "Complete field (80ft x 90ft)" },
  SHARED: { name: "Standard Court", description: "Dedicated shared court" },
};
