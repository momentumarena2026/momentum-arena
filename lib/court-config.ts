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
  // Badminton — same shared court
  {
    sport: "BADMINTON",
    size: "SHARED",
    label: "Badminton Court",
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
  BADMINTON: {
    name: "Badminton",
    icon: "badminton",
    color: "purple",
    description: "Shared court with standard markings",
  },
};

// Size display info
export const SIZE_INFO: Record<
  ConfigSize,
  { name: string; description: string }
> = {
  XS: { name: "Small (Leather ball practice.)", description: "Leather pitch (10ft x 90ft)" },
  SMALL: { name: "Small (Leather ball practice.)", description: "Single box lane (30ft x 90ft)" },
  MEDIUM: {
    name: "Medium",
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
