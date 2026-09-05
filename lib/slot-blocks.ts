/**
 * Blocking court time on behalf of an EVENT, and knowing who did.
 *
 * Two things every caller here needs and none of them had:
 *
 *   1. A recurring window expands to a concrete list of (date, hour)
 *      pairs the same way for a camp as for a tournament. Duplicating
 *      that arithmetic per caller is how two features come to disagree
 *      about whether a Sunday counts.
 *
 *   2. A block says what put it there. Every tournament block used to
 *      read "Tournament window" — true, identical for every tournament
 *      and every sport, and therefore useless to an admin looking at a
 *      blocked Tuesday and deciding whether it can move.
 *
 * And the thing nobody was doing at all: checking whether the window
 * being blocked is already spoken for. Two events could be scheduled on
 * top of each other and neither the person creating the second one nor
 * the calendar would say a word.
 */

import { db } from "@/lib/db";
import { Sport, type CourtZone } from "@prisma/client";
import { zonesOverlap } from "@/lib/court-config";

export type BlockSource = "TOURNAMENT" | "CAMP" | "MANUAL";

/** One hour of one day, in the venue's own storage convention. */
export type BlockWindow = { date: Date; hour: number };

/**
 * Every (date, hour) a recurring schedule covers.
 *
 * `daysOfWeek` is 0=Sunday..6=Saturday, matching Camp.daysOfWeek and
 * JavaScript's getUTCDay. Dates are handled in UTC because the venue
 * stores calendar days as @db.Date — a local-time walk would shift the
 * boundary and drop or double the last day depending on the server's
 * timezone, which is exactly the class of bug the rest of this codebase
 * uses lib/ist.ts to avoid.
 *
 * `endHour` is exclusive, so 16..18 is two blocked hours, not three.
 */
export function expandWindows(schedule: {
  startDate: Date;
  endDate: Date;
  daysOfWeek: number[];
  startHour: number;
  endHour: number;
}): BlockWindow[] {
  const out: BlockWindow[] = [];
  if (schedule.endHour <= schedule.startHour) return out;
  if (schedule.daysOfWeek.length === 0) return out;

  const days = new Set(schedule.daysOfWeek);
  const cursor = new Date(
    Date.UTC(
      schedule.startDate.getUTCFullYear(),
      schedule.startDate.getUTCMonth(),
      schedule.startDate.getUTCDate(),
    ),
  );
  const last = Date.UTC(
    schedule.endDate.getUTCFullYear(),
    schedule.endDate.getUTCMonth(),
    schedule.endDate.getUTCDate(),
  );

  // A guard, not a limit: a camp running for years is a data-entry
  // mistake, and expanding it would raise tens of thousands of rows
  // before anybody noticed.
  let guard = 0;
  while (cursor.getTime() <= last && guard++ < 800) {
    if (days.has(cursor.getUTCDay())) {
      for (let h = schedule.startHour; h < schedule.endHour; h++) {
        out.push({ date: new Date(cursor), hour: h });
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/**
 * The human sentence a calendar cell shows.
 *
 * Names the event AND the sport, because "Tournament window" answers
 * neither of the two questions an admin actually has: which one, and
 * does it involve my sport.
 */
export function blockLabel(
  source: BlockSource,
  eventName: string,
  sport: Sport | null,
): string {
  const kind = source === "TOURNAMENT" ? "Tournament" : source === "CAMP" ? "Camp" : "Blocked";
  const parts = [kind, eventName.trim()].filter(Boolean);
  const label = parts.join(": ");
  return sport ? `${label} (${sport.toLowerCase()})` : label;
}

export type Conflict = {
  date: string;
  hour: number;
  label: string;
  sourceType: string | null;
  sourceId: string | null;
};

/**
 * The physical ground a claim covers.
 *
 * Conflicts are a question about SPACE, not about sport. A cricket
 * tournament and a football tournament are different sports played on
 * the same turf: blocking the same Saturday evening for both is a clash
 * even though nothing about the two events matches. Filtering candidate
 * conflicts by sport — which this did first — would have missed exactly
 * that case and let two events be scheduled on top of each other in
 * silence.
 *
 * Zones are how the rest of the codebase already models shared ground
 * (see lib/availability.ts and zonesOverlap), so this uses the same
 * currency rather than inventing a second one.
 */
export async function zonesForSport(sport: Sport): Promise<CourtZone[]> {
  const configs = await db.courtConfig
    .findMany({ where: { sport, isActive: true }, select: { zones: true } })
    .catch(() => []);
  return [...new Set(configs.flatMap((c) => c.zones as CourtZone[]))];
}

export async function zonesForConfig(courtConfigId: string): Promise<CourtZone[]> {
  const config = await db.courtConfig
    .findUnique({ where: { id: courtConfigId }, select: { zones: true } })
    .catch(() => null);
  return (config?.zones as CourtZone[]) ?? [];
}

/**
 * What is ALREADY blocked on the ground a claim covers.
 *
 * An existing block occupies ground in one of three ways, and each has
 * to be resolved to zones before it can be compared:
 *
 *   a named court   → that court's zones
 *   a sport only    → every active court of that sport
 *   neither         → the whole venue, so it always conflicts
 *
 * Blocks belonging to `ignore` are skipped, so recomputing an event's
 * own windows never reports the event conflicting with itself — without
 * it, every edit to a camp would warn about the camp.
 *
 * Returns at most `limit`. The caller is showing a human a warning, and
 * four hundred overlapping hours is not a warning, it is a wall.
 */
export async function findBlockConflicts(
  windows: BlockWindow[],
  opts: {
    /** The ground being claimed. Empty means "unknown", and nothing is
     *  reported rather than everything — a warning that always fires is
     *  a warning nobody reads. */
    claimZones: CourtZone[];
    ignore?: { sourceType: BlockSource; sourceId: string };
    limit?: number;
  },
): Promise<Conflict[]> {
  if (windows.length === 0 || opts.claimZones.length === 0) return [];
  const limit = opts.limit ?? 8;

  // One query for the whole date span rather than per window: a camp can
  // expand to several hundred windows, and that many round trips inside
  // an admin save is a timeout.
  const dates = windows.map((w) => w.date.getTime());
  const from = new Date(Math.min(...dates));
  const to = new Date(Math.max(...dates));

  const existing = await db.slotBlock
    .findMany({
      where: { date: { gte: from, lte: to } },
      select: {
        date: true,
        startHour: true,
        reason: true,
        sport: true,
        sourceType: true,
        sourceId: true,
        sourceLabel: true,
        courtConfig: { select: { zones: true } },
      },
    })
    .catch(() => []);

  // Resolve sport-wide blocks once, not per row.
  const sportZones = new Map<Sport, CourtZone[]>();
  for (const b of existing) {
    if (b.sport && !b.courtConfig && !sportZones.has(b.sport)) {
      sportZones.set(b.sport, await zonesForSport(b.sport));
    }
  }

  const wanted = new Set(windows.map((w) => `${w.date.toISOString().slice(0, 10)}@${w.hour}`));
  const seen = new Set<string>();
  const out: Conflict[] = [];

  for (const b of existing) {
    if (
      opts.ignore &&
      b.sourceType === opts.ignore.sourceType &&
      b.sourceId === opts.ignore.sourceId
    ) {
      continue;
    }

    const heldZones = b.courtConfig
      ? (b.courtConfig.zones as CourtZone[])
      : b.sport
        ? (sportZones.get(b.sport) ?? [])
        : null; // null = the whole venue
    if (heldZones !== null && !zonesOverlap(heldZones, opts.claimZones)) continue;

    const day = b.date.toISOString().slice(0, 10);
    // A full-day block (startHour null) collides with every hour we want
    // on that day.
    const hours =
      b.startHour == null
        ? windows.filter((w) => w.date.toISOString().slice(0, 10) === day).map((w) => w.hour)
        : [b.startHour];
    for (const h of hours) {
      const key = `${day}@${h}`;
      if (!wanted.has(key) || seen.has(key)) continue;
      seen.add(key);
      out.push({
        date: day,
        hour: h,
        label: b.sourceLabel || b.reason || "Already blocked",
        sourceType: b.sourceType,
        sourceId: b.sourceId,
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/**
 * Bookings already sold on the ground a claim covers.
 *
 * Zone-based for the same reason: a football booking on a shared turf is
 * in the way of a cricket camp, whatever the sports say. Blocking hides
 * the slot from everyone else but cannot un-sell it, so somebody has to
 * ring these customers — which is why they are reported separately from
 * event clashes.
 */
export async function findBookingConflicts(
  windows: BlockWindow[],
  claimZones: CourtZone[],
  limit = 8,
): Promise<{ date: string; hour: number; label: string }[]> {
  if (windows.length === 0 || claimZones.length === 0) return [];
  const dates = windows.map((w) => w.date.getTime());
  const from = new Date(Math.min(...dates));
  const to = new Date(Math.max(...dates));

  const bookings = await db.booking
    .findMany({
      where: {
        date: { gte: from, lte: to },
        status: { in: ["CONFIRMED", "PENDING"] },
      },
      select: {
        date: true,
        // Hours live on the child rows, not on the booking.
        slots: { select: { startHour: true } },
        courtConfig: { select: { label: true, zones: true, sport: true } },
      },
      take: 500,
    })
    .catch(() => []);

  const wanted = new Set(windows.map((w) => `${w.date.toISOString().slice(0, 10)}@${w.hour}`));
  const out: { date: string; hour: number; label: string }[] = [];
  for (const b of bookings) {
    const zones = (b.courtConfig?.zones as CourtZone[]) ?? [];
    if (!zonesOverlap(zones, claimZones)) continue;
    const day = b.date.toISOString().slice(0, 10);
    for (const slot of b.slots) {
      if (!wanted.has(`${day}@${slot.startHour}`)) continue;
      out.push({
        date: day,
        hour: slot.startHour,
        label: b.courtConfig
          ? `${b.courtConfig.label} (${b.courtConfig.sport.toLowerCase()})`
          : "Booked",
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
