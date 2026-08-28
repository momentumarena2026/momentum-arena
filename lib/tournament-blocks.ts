import { db } from "@/lib/db";

/**
 * The venue hours a tournament holds, released and re-taken as a unit.
 *
 * `addTournamentSlot` raises a SlotBlock per hour the moment a window is
 * created — deliberately, so the tournament can't lose its own slots to
 * public bookings while the draw is still being planned — and records the
 * ids on `TournamentSlot.slotBlockIds`. Until now nothing released them in
 * bulk: cancelling a tournament left every hour dark, and an admin had to
 * delete each window by hand to hand the grid back.
 *
 * Both directions live here because they are one decision. A cancel in this
 * codebase is reversible (`STATUS_FLOW.CANCELLED` returns to six statuses,
 * added so a mis-clicked cancel is recoverable), so releasing without a way
 * to re-take would turn a mis-click into silently sold-off tournament hours
 * — a worse bug than the one being fixed.
 */

/** The block reason `addTournamentSlot` stamps. Kept identical so released
 *  and re-raised blocks are indistinguishable to every other reader. */
const BLOCK_REASON = "Tournament window";

/**
 * Hand a tournament's blocked hours back to the public booking grid.
 *
 * Clears `slotBlockIds` as well as deleting the blocks, so the windows are
 * left in a truthful state: a stale id list would make `deleteTournamentSlot`
 * appear to release hours it no longer owns, and would make a later restore
 * skip windows it should re-raise.
 *
 * Idempotent — a window with no blocks (no court assigned, or already
 * released) is simply skipped.
 */
export async function releaseTournamentBlocks(
  tournamentId: string,
): Promise<{ released: number; windows: number }> {
  const slots = await db.tournamentSlot.findMany({
    where: { tournamentId },
    select: { id: true, slotBlockIds: true },
  });
  const blockIds = slots.flatMap((s) => s.slotBlockIds);
  if (blockIds.length === 0) return { released: 0, windows: 0 };

  const touched = slots.filter((s) => s.slotBlockIds.length > 0);
  await db.$transaction([
    db.slotBlock.deleteMany({ where: { id: { in: blockIds } } }),
    ...touched.map((s) =>
      db.tournamentSlot.update({
        where: { id: s.id },
        data: { slotBlockIds: [] },
      }),
    ),
  ]);
  return { released: blockIds.length, windows: touched.length };
}

/**
 * Re-take the hours after a cancelled tournament is restored.
 *
 * Only windows that actually carry a court are re-blocked — a window with no
 * `courtConfigId` never had blocks to begin with, matching
 * `addTournamentSlot`.
 *
 * **Hours booked while the tournament was cancelled are NOT taken back and
 * existing bookings are never cancelled.** That mirrors `addTournamentSlot`,
 * which counts clashing bookings and surfaces the number rather than
 * bulldozing them: a customer who legitimately booked a freed hour keeps it,
 * and the admin is told how many need moving by hand. The block is still
 * raised so nothing NEW can be sold on that hour.
 */
export async function restoreTournamentBlocks(
  tournamentId: string,
  adminId: string,
): Promise<{ raised: number; clashes: number }> {
  const slots = await db.tournamentSlot.findMany({
    where: { tournamentId },
    select: {
      id: true,
      date: true,
      startHour: true,
      endHour: true,
      courtConfigId: true,
      slotBlockIds: true,
    },
  });

  let raised = 0;
  let clashes = 0;

  for (const s of slots) {
    // No court = never blocked; already populated = nothing to restore.
    if (!s.courtConfigId || s.slotBlockIds.length > 0) continue;
    const hours = Array.from(
      { length: Math.max(0, s.endHour - s.startHour) },
      (_, i) => s.startHour + i,
    );
    if (hours.length === 0) continue;

    clashes += await db.booking.count({
      where: {
        courtConfigId: s.courtConfigId,
        date: s.date,
        status: { in: ["CONFIRMED", "COMPLETED"] },
        slots: { some: { startHour: { in: hours } } },
      },
    });

    const created = await db.slotBlock.createManyAndReturn({
      data: hours.map((h) => ({
        courtConfigId: s.courtConfigId as string,
        date: s.date,
        startHour: h,
        reason: BLOCK_REASON,
        blockedBy: adminId,
      })),
      select: { id: true },
    });
    await db.tournamentSlot.update({
      where: { id: s.id },
      data: { slotBlockIds: created.map((b) => b.id) },
    });
    raised += created.length;
  }

  return { raised, clashes };
}
