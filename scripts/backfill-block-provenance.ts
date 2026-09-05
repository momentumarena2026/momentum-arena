/**
 * Give existing SlotBlocks their identity back.
 *
 * Blocks raised before provenance existed carry only the words
 * "Tournament window" — true of every tournament and every sport, and so
 * useless to an admin looking at a blocked Tuesday and deciding whether
 * it can move. New blocks now store sourceType/sourceId/sourceLabel; the
 * old ones need it filled in.
 *
 * The owner is recovered from the other side of the link:
 * TournamentSlot.slotBlockIds already lists the blocks each window
 * raised, so a block's tournament is whichever slot claims it. Nothing
 * is guessed from the text.
 *
 * Camps are done the same way via Camp.slotBlockIds, though in practice
 * no camp block predates this — camp blocking and provenance shipped
 * together.
 *
 * Dry run by default. Pass --apply to write.
 *
 *   npx tsx scripts/backfill-block-provenance.ts [--apply]
 */
import { PrismaClient, type Sport } from "@prisma/client";

const db = new PrismaClient();
const APPLY = process.argv.includes("--apply");

/** Mirrors blockLabel() in lib/slot-blocks.ts. */
function label(kind: "Tournament" | "Camp", name: string, sport: Sport | null): string {
  const base = [kind, name.trim()].filter(Boolean).join(": ");
  return sport ? `${base} (${sport.toLowerCase()})` : base;
}

async function main() {
  console.log(APPLY ? "APPLYING" : "DRY RUN — pass --apply to write");
  console.log("");

  // Every block that has no owner recorded. Includes rows whose `reason`
  // is something else entirely: an unlabelled block is unlabelled
  // whatever it happens to say.
  const orphans = await db.slotBlock.findMany({
    where: { sourceType: null },
    select: { id: true, reason: true, date: true, startHour: true },
  });
  console.log(`Blocks with no recorded owner: ${orphans.length}`);
  if (orphans.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  const orphanIds = new Set(orphans.map((o) => o.id));

  // ── Resolve owners from the other side of the link ────────────────
  const [slots, camps] = await Promise.all([
    db.tournamentSlot.findMany({
      where: { slotBlockIds: { isEmpty: false } },
      select: {
        slotBlockIds: true,
        tournament: { select: { id: true, name: true, sport: true } },
      },
    }),
    db.camp.findMany({
      where: { slotBlockIds: { isEmpty: false } },
      select: { id: true, name: true, sport: true, slotBlockIds: true },
    }),
  ]);

  type Owner = { type: "TOURNAMENT" | "CAMP"; id: string; label: string };
  const owner = new Map<string, Owner>();

  for (const s of slots) {
    if (!s.tournament) continue;
    const text = label("Tournament", s.tournament.name, s.tournament.sport);
    for (const id of s.slotBlockIds) {
      if (orphanIds.has(id)) {
        owner.set(id, { type: "TOURNAMENT", id: s.tournament.id, label: text });
      }
    }
  }
  for (const c of camps) {
    const text = label("Camp", c.name, c.sport);
    for (const id of c.slotBlockIds) {
      if (orphanIds.has(id)) owner.set(id, { type: "CAMP", id: c.id, label: text });
    }
  }

  const matched = orphans.filter((o) => owner.has(o.id));
  const unmatched = orphans.filter((o) => !owner.has(o.id));

  console.log(`  traced to an event: ${matched.length}`);
  console.log(`  no owner found:     ${unmatched.length}`);
  console.log("");

  // What the calendar will read after this runs.
  const byLabel = new Map<string, number>();
  for (const m of matched) {
    const l = owner.get(m.id)!.label;
    byLabel.set(l, (byLabel.get(l) ?? 0) + 1);
  }
  for (const [l, n] of [...byLabel.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)} × ${l}`);
  }

  if (unmatched.length > 0) {
    console.log("");
    // Left exactly as they are. A block nothing claims is most likely a
    // manual one an admin raised by hand, and inventing an owner for it
    // would put a confident, wrong sentence on the calendar — worse than
    // the vague one it replaces.
    console.log("Unclaimed blocks are left untouched (manual blocks, or events since deleted):");
    for (const u of unmatched.slice(0, 10)) {
      console.log(
        `  ${u.date.toISOString().slice(0, 10)} ${u.startHour ?? "all day"} — ${u.reason ?? "(no reason)"}`,
      );
    }
    if (unmatched.length > 10) console.log(`  … and ${unmatched.length - 10} more`);
  }

  if (!APPLY) {
    console.log("");
    console.log("DRY RUN — nothing written.");
    return;
  }

  // Grouped by owner so this is a handful of updateMany calls rather than
  // one per block.
  const groups = new Map<string, { owner: Owner; ids: string[] }>();
  for (const m of matched) {
    const o = owner.get(m.id)!;
    const key = `${o.type}:${o.id}`;
    const g = groups.get(key) ?? { owner: o, ids: [] };
    g.ids.push(m.id);
    groups.set(key, g);
  }

  let written = 0;
  for (const { owner: o, ids } of groups.values()) {
    const res = await db.slotBlock.updateMany({
      where: { id: { in: ids } },
      data: {
        sourceType: o.type,
        sourceId: o.id,
        sourceLabel: o.label,
        // `reason` is updated too: it is what older surfaces still read,
        // and leaving it saying "Tournament window" would mean the same
        // block reads differently depending on which screen you are on.
        reason: o.label,
      },
    });
    written += res.count;
  }

  console.log("");
  console.log(`Updated ${written} blocks.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
