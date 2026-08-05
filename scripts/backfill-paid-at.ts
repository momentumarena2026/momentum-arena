/**
 * Backfill `paidAt` on tournament teams and camp registrations that were
 * confirmed BEFORE the column existed.
 *
 * paidAt is the cash-basis date analytics and the CA report key on, so
 * rows without it are invisible to both — that's the "money missing from
 * reporting" symptom this fixes. There is no record of the exact moment
 * those older payments landed; `createdAt` is the honest proxy, since a
 * tournament team or camp registration is created at the point of
 * payment (or within minutes of it).
 *
 *   npx tsx --env-file=.env scripts/backfill-paid-at.ts            # dry run
 *   npx tsx --env-file=.env scripts/backfill-paid-at.ts --apply    # write
 *   ... --since 2026-08-04                                         # window
 *
 * Dry run by default: it prints every row it would touch and the month
 * each one would land in, so the totals can be checked against the books
 * BEFORE anything is written.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const apply = process.argv.includes("--apply");
const sinceArg = process.argv[process.argv.indexOf("--since") + 1];
const since =
  process.argv.includes("--since") && sinceArg
    ? new Date(`${sinceArg}T00:00:00+05:30`)
    : null;

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const month = (d: Date) =>
  d.toLocaleDateString("en-IN", {
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });

async function main() {
  const window = since ? { gte: since } : undefined;

  const teams = await db.tournamentTeam.findMany({
    where: {
      paidAt: null,
      paidAmount: { gt: 0 },
      status: "CONFIRMED",
      ...(window ? { createdAt: window } : {}),
    },
    select: {
      id: true,
      name: true,
      paidAmount: true,
      createdAt: true,
      tournament: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const camps = await db.campRegistration.findMany({
    where: {
      paidAt: null,
      paidAmount: { gt: 0 },
      status: "CONFIRMED",
      ...(window ? { createdAt: window } : {}),
    },
    select: {
      id: true,
      participantName: true,
      paidAmount: true,
      createdAt: true,
      camp: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(
    `${apply ? "APPLYING" : "DRY RUN"}${
      since
        ? ` · since ${since.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })} IST`
        : " · all time"
    }\n`,
  );

  const byMonth = new Map<string, number>();

  console.log(`Tournament teams: ${teams.length}`);
  for (const t of teams) {
    const m = month(t.createdAt);
    byMonth.set(m, (byMonth.get(m) ?? 0) + t.paidAmount);
    console.log(
      `  ${t.createdAt.toISOString().slice(0, 10)}  ${inr(t.paidAmount).padStart(10)}  ${t.tournament.name} — ${t.name}`,
    );
  }

  console.log(`\nCamp registrations: ${camps.length}`);
  for (const c of camps) {
    const m = month(c.createdAt);
    byMonth.set(m, (byMonth.get(m) ?? 0) + c.paidAmount);
    console.log(
      `  ${c.createdAt.toISOString().slice(0, 10)}  ${inr(c.paidAmount).padStart(10)}  ${c.camp.name} — ${c.participantName}`,
    );
  }

  console.log("\nRevenue this would add, by month:");
  if (byMonth.size === 0) console.log("  (nothing)");
  for (const [m, total] of [...byMonth].sort()) {
    console.log(`  ${m.padEnd(12)} ${inr(total)}`);
  }

  if (!apply) {
    console.log("\nDry run — nothing written. Re-run with --apply to commit.");
    return;
  }

  for (const t of teams) {
    await db.tournamentTeam.update({
      where: { id: t.id },
      data: { paidAt: t.createdAt },
    });
  }
  for (const c of camps) {
    await db.campRegistration.update({
      where: { id: c.id },
      data: { paidAt: c.createdAt },
    });
  }
  console.log(
    `\n✓ Stamped ${teams.length} team(s) and ${camps.length} registration(s).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
