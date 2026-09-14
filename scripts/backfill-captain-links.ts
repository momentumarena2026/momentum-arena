/**
 * Attach the customer account to every team that was registered without one.
 *
 * Venue registration never set captainUserId, so teams entered at the
 * counter are orphans: a row holding the captain's phone number with no
 * link to the person behind it. Registration links them now, but every
 * team already in the database is still unlinked, and the consequence only
 * ever surfaces much later — a prize pass with nobody to issue it to.
 *
 * Links ONLY where exactly one account uses the number. Several accounts
 * on one number are left alone: attaching the wrong one hands a stranger
 * somebody else's passes and booking history, which is worse than the
 * problem being fixed.
 *
 * Idempotent — an already-linked team is never touched, so re-running is
 * free.
 *
 *   npx tsx scripts/backfill-captain-links.ts [--apply]
 */
import { PrismaClient } from "@prisma/client";
import { matchUserByPhone } from "../lib/phone-match";

const db = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(APPLY ? "APPLYING" : "DRY RUN — pass --apply to write");
  console.log("");

  const teams = await db.tournamentTeam.findMany({
    where: { captainUserId: null },
    select: {
      id: true,
      name: true,
      captainName: true,
      captainPhone: true,
      tournament: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  console.log(`Teams with no linked captain: ${teams.length}`);
  if (teams.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  const linkable: { id: string; userId: string; label: string }[] = [];
  const noAccount: string[] = [];
  const ambiguous: string[] = [];
  const unusable: string[] = [];

  for (const t of teams) {
    const label = `${t.tournament?.name ?? "—"} / ${t.name} (${t.captainName})`;
    const m = await matchUserByPhone(db, t.captainPhone);
    if (m.kind === "one") linkable.push({ id: t.id, userId: m.userId, label });
    else if (m.kind === "none") noAccount.push(label);
    else if (m.kind === "many") ambiguous.push(`${label} — ${m.count} accounts`);
    else unusable.push(`${label} — "${t.captainPhone}"`);
  }

  console.log(`  can be linked:        ${linkable.length}`);
  console.log(`  captain has no account: ${noAccount.length}`);
  console.log(`  several accounts:     ${ambiguous.length}`);
  console.log(`  phone unusable:       ${unusable.length}`);
  console.log("");

  const show = (title: string, rows: string[]) => {
    if (rows.length === 0) return;
    console.log(title);
    for (const r of rows.slice(0, 15)) console.log(`   ${r}`);
    if (rows.length > 15) console.log(`   … and ${rows.length - 15} more`);
    console.log("");
  };

  if (linkable.length) {
    console.log("Would link:");
    for (const l of linkable.slice(0, 15)) console.log(`   ${l.label}`);
    if (linkable.length > 15) console.log(`   … and ${linkable.length - 15} more`);
    console.log("");
  }
  // These are the ones a human has to deal with, so they are named rather
  // than counted — the venue can ring the captain, or merge the duplicates.
  show("Left alone — captain has never signed up:", noAccount);
  show("Left alone — more than one account on that number:", ambiguous);
  show("Left alone — phone number isn't a mobile:", unusable);

  if (!APPLY) {
    console.log("DRY RUN — nothing written.");
    return;
  }

  let done = 0;
  for (const l of linkable) {
    await db.tournamentTeam.update({
      where: { id: l.id },
      data: { captainUserId: l.userId },
    });
    done += 1;
  }
  console.log(`Linked ${done} teams.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
