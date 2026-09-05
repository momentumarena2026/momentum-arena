/**
 * Holding the courts a camp's sessions run on.
 *
 * A camp already describes its own schedule — a date range, the weekdays
 * it meets, and an hour window — so blocking the courts for it is not
 * new information, it is the same information applied. The admin toggles
 * one switch and every session for the whole camp is held.
 *
 * Blocks are raised against the SPORT rather than a single court,
 * because a camp does not name a court: it is "the football camp", and
 * it occupies whatever football surface the venue puts it on.
 *
 * The set is recomputed rather than patched. A camp's schedule is small
 * enough to expand cheaply, and diffing it would mean maintaining a
 * second, subtler description of the same thing — the arrangement that
 * lets two representations drift until an admin finds a blocked Tuesday
 * belonging to a camp that stopped meeting on Tuesdays.
 */

import { db } from "@/lib/db";
import { Sport } from "@prisma/client";
import {
  blockLabel,
  expandWindows,
  findBlockConflicts,
  findBookingConflicts,
  zonesForConfig,
  zonesForSport,
  type BlockWindow,
  type Conflict,
} from "@/lib/slot-blocks";

export type CampSchedule = {
  id: string;
  name: string;
  /** Optional — a camp is not always one of the sports the venue sells. */
  sport: Sport | null;
  /** The court the camp occupies. Blocking needs this, not the sport. */
  courtConfigId: string | null;
  startDate: Date;
  endDate: Date;
  daysOfWeek: number[];
  startHour: number;
  endHour: number;
};

export function campWindows(camp: CampSchedule): BlockWindow[] {
  return expandWindows(camp);
}

/**
 * What blocking this camp would run into.
 *
 * Two separate answers, because they mean different things to whoever is
 * about to click save. Another EVENT on the same window is a scheduling
 * clash somebody has to resolve. A BOOKING already sold is money and a
 * customer — the block will hide the slot from everyone else but cannot
 * un-sell it, so somebody has to ring them.
 */
export async function campBlockConflicts(camp: CampSchedule): Promise<{
  windows: number;
  blocks: Conflict[];
  bookings: { date: string; hour: number; label: string }[];
}> {
  const windows = campWindows(camp);
  // The GROUND the camp will occupy. Read from the chosen COURT, because
  // that is the physical truth and because a camp need not have a sport
  // at all — Taekwondo on the cricket turf occupies the turf, and no
  // sport field describes that.
  //
  // A cricket tournament already holding this Saturday evening is in the
  // way of a Taekwondo camp on the same turf, and nothing about the two
  // says so — only the zones do.
  const claimZones = camp.courtConfigId
    ? await zonesForConfig(camp.courtConfigId)
    : camp.sport
      ? await zonesForSport(camp.sport)
      : [];
  const [blocks, bookings] = await Promise.all([
    findBlockConflicts(windows, {
      claimZones,
      // Never report a camp as clashing with itself; without this every
      // edit warns about the camp being edited.
      ignore: { sourceType: "CAMP", sourceId: camp.id },
    }),
    findBookingConflicts(windows, claimZones),
  ]);
  return { windows: windows.length, blocks, bookings };
}

/**
 * Make the camp's blocks match its schedule exactly.
 *
 * Releases whatever it holds now and raises the current window set, in a
 * transaction: a camp that has released its old blocks and not yet
 * raised its new ones is a window the public can book into, and the gap
 * would be invisible.
 */
export async function syncCampBlocks(
  camp: CampSchedule,
  blockedBy: string,
): Promise<number> {
  const windows = campWindows(camp);
  const label = blockLabel("CAMP", camp.name, camp.sport);
  if (!camp.courtConfigId && !camp.sport) {
    // Nothing to hold: without a court or a sport there is no ground to
    // reserve, and a block scoped to neither would silently close the
    // ENTIRE venue.
    await releaseCampBlocks(camp.id);
    return 0;
  }

  const created = await db.$transaction(async (tx) => {
    const existing = await tx.camp.findUnique({
      where: { id: camp.id },
      select: { slotBlockIds: true },
    });
    if (existing?.slotBlockIds.length) {
      await tx.slotBlock.deleteMany({ where: { id: { in: existing.slotBlockIds } } });
    }
    if (windows.length === 0) {
      await tx.camp.update({ where: { id: camp.id }, data: { slotBlockIds: [] } });
      return [] as string[];
    }
    // createMany cannot return ids, and the ids are what lets this set be
    // released later — so they are generated here and written to both
    // tables from the same list.
    const rows = windows.map((w) => ({
      // The COURT is what holds the ground. Availability reads a
      // config-scoped block through zone overlap, so blocking the full
      // field also blocks its half-courts — which is what "hold the turf"
      // has to mean. `sport` is carried only when there is one, and only
      // as a label.
      sport: camp.courtConfigId ? null : camp.sport,
      courtConfigId: camp.courtConfigId,
      date: w.date,
      startHour: w.hour,
      reason: label,
      blockedBy,
      sourceType: "CAMP",
      sourceId: camp.id,
      sourceLabel: label,
    }));
    const made = await tx.slotBlock.createManyAndReturn({
      data: rows,
      select: { id: true },
    });
    const ids = made.map((m) => m.id);
    await tx.camp.update({ where: { id: camp.id }, data: { slotBlockIds: ids } });
    return ids;
  });

  return created.length;
}

/** Give the courts back. Used when the toggle goes off, and on delete. */
export async function releaseCampBlocks(campId: string): Promise<number> {
  return db.$transaction(async (tx) => {
    const camp = await tx.camp.findUnique({
      where: { id: campId },
      select: { slotBlockIds: true },
    });
    const ids = camp?.slotBlockIds ?? [];
    if (ids.length === 0) return 0;
    await tx.slotBlock.deleteMany({ where: { id: { in: ids } } });
    await tx.camp.update({ where: { id: campId }, data: { slotBlockIds: [] } });
    return ids.length;
  });
}

/**
 * Windows the new schedule would block that the old one did not.
 *
 * This is what the admin is warned about when they extend a camp. An
 * end date moved from March to June is a small edit to a form and a
 * large change to the calendar — three months of evenings withdrawn from
 * sale — and the person making it should be told the number before it
 * happens, not discover it afterwards.
 */
export function newlyBlockedWindows(before: CampSchedule, after: CampSchedule): number {
  const had = new Set(
    campWindows(before).map((w) => `${w.date.toISOString().slice(0, 10)}@${w.hour}`),
  );
  return campWindows(after).filter(
    (w) => !had.has(`${w.date.toISOString().slice(0, 10)}@${w.hour}`),
  ).length;
}
