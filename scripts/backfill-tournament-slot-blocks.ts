/**
 * Raise SlotBlocks for tournament windows created BEFORE blocking moved
 * to window-creation time.
 *
 * Those windows reserved nothing — their hours stayed on sale until the
 * draw was approved. This blocks them retroactively so the venue can't
 * sell a window the tournament already owns.
 *
 * Dry run by default. Pass --apply to write.
 *
 *   npx tsx scripts/backfill-tournament-slot-blocks.ts [--apply]
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(APPLY ? "APPLYING" : "DRY RUN");
  console.log("");

  // Only windows that never raised blocks and name a court — a window
  // with no court has nothing to block.
  const slots = await db.tournamentSlot.findMany({
    where: { slotBlockIds: { isEmpty: true }, courtConfigId: { not: null } },
    include: {
      tournament: { select: { name: true, status: true } },
      courtConfig: { select: { label: true } },
    },
    orderBy: [{ date: "asc" }, { startHour: "asc" }],
  });

  if (slots.length === 0) {
    console.log("No unblocked windows found — nothing to do.");
    return;
  }

  let created = 0;
  let clashTotal = 0;
  for (const s of slots) {
    const hours = Array.from(
      { length: s.endHour - s.startHour },
      (_, i) => s.startHour + i,
    );
    // Don't duplicate: a block may already exist for this court+hour
    // (e.g. raised by hand, or by a scheduled match under the old path).
    const existing = await db.slotBlock.findMany({
      where: { courtConfigId: s.courtConfigId, date: s.date, startHour: { in: hours } },
      select: { id: true, startHour: true },
    });
    const have = new Set(existing.map((x) => x.startHour));
    const missing = hours.filter((h) => !have.has(h));

    const clashes = await db.booking.count({
      where: {
        courtConfigId: s.courtConfigId!,
        date: s.date,
        status: { in: ["CONFIRMED", "COMPLETED"] },
        slots: { some: { startHour: { in: hours } } },
      },
    });
    clashTotal += clashes;

    const day = s.date.toISOString().slice(0, 10);
    console.log(
      `  ${day} ${s.startHour}-${s.endHour}  ${s.courtConfig?.label ?? "?"}  ` +
        `${s.tournament.name} [${s.tournament.status}]  ` +
        `→ ${missing.length} block(s) to add` +
        (existing.length ? `, ${existing.length} already blocked` : "") +
        (clashes ? `  ⚠ ${clashes} existing booking(s)` : ""),
    );

    if (APPLY) {
      const ids = existing.map((x) => x.id);
      for (const h of missing) {
        const b = await db.slotBlock.create({
          data: {
            courtConfigId: s.courtConfigId,
            date: s.date,
            startHour: h,
            reason: "Tournament window",
            blockedBy: "backfill",
          },
        });
        ids.push(b.id);
      }
      await db.tournamentSlot.update({
        where: { id: s.id },
        data: { slotBlockIds: ids },
      });
      created += missing.length;
    } else {
      created += missing.length;
    }
  }

  console.log("");
  console.log(
    `${APPLY ? "✓ Created" : "Would create"} ${created} SlotBlock(s) across ${slots.length} window(s).`,
  );
  if (clashTotal > 0) {
    console.log(
      `⚠ ${clashTotal} existing booking(s) already sit inside these windows — ` +
        `blocking does not cancel them, move them from the admin calendar.`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
