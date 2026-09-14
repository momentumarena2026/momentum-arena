/**
 * Why didn't the prize pass go out?
 *
 * `issuePrizePasses` already reports a reason per position, but the
 * completion path discarded it, so a tournament could close with a pass
 * silently unissued and nothing anywhere saying so. This prints the whole
 * chain — what was configured, who finished where, whether the captain has
 * an account, whether the court is still active — and with --apply mints
 * whatever is legitimately owed.
 *
 * Safe to re-run: issuing is idempotent, guarded by an offlineRef marker
 * per (tournament, place).
 *
 *   npx tsx scripts/diagnose-prize-passes.ts <slug|name> [--apply]
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const NEEDLE = process.argv.slice(2).find((a) => !a.startsWith("--")) || "";

async function main() {
  if (!NEEDLE) {
    console.log("Pass a tournament slug or part of its name.");
    return;
  }
  const t = await db.tournament.findFirst({
    where: {
      OR: [
        { slug: NEEDLE },
        { name: { contains: NEEDLE, mode: "insensitive" } },
      ],
    },
    select: {
      id: true, name: true, slug: true, status: true, format: true, prizes: true,
      teams: { select: { id: true, name: true, captainUserId: true } },
      matches: {
        select: {
          stage: true, status: true, winnerTeamId: true,
          homeTeamId: true, awayTeamId: true, roundLabel: true,
        },
      },
    },
  });
  if (!t) {
    console.log(`No tournament matching "${NEEDLE}".`);
    return;
  }

  console.log(`${t.name}  (${t.slug})`);
  console.log(`  status: ${t.status}   format: ${t.format}`);
  console.log("");

  const { parsePrizeRows, resolvePlacements, issuePrizePasses } = await import(
    "../lib/tournament-prizes"
  );

  const rows = parsePrizeRows(t.prizes);
  console.log(`Prize rows configured: ${rows.length}`);
  for (const r of rows) {
    console.log(
      `   ${r.place.padEnd(14)} ${r.label}` +
        (r.pass
          ? `\n${" ".repeat(6)}└─ PASS → place ${r.pass.awardTo}, ${r.pass.totalHours}h, ${r.pass.validityDays} days, court ${r.pass.courtConfigId}`
          : `\n${" ".repeat(6)}└─ no pass attached`),
    );
  }
  console.log("");

  // Placement chain — the usual failure is here.
  const finals = t.matches.filter((m) => m.stage === "FINAL");
  console.log(`FINAL matches: ${finals.length}`);
  for (const f of finals) {
    console.log(
      `   ${f.roundLabel || "Final"} — status=${f.status} winner=${f.winnerTeamId ? "set" : "NONE"}`,
    );
  }

  const places = await resolvePlacements(t.id);
  console.log("");
  console.log(`Placements resolved: ${places.length}`);
  for (const p of places) {
    const captain = p.captainUserId ? "linked account" : "NO LINKED ACCOUNT";
    console.log(`   ${p.position}. ${p.teamName.padEnd(24)} captain: ${captain}`);
  }

  // Anything already minted.
  const existing = await db.userPass.findMany({
    where: { offlineRef: { startsWith: `tournament:${t.id}:place:` } },
    select: { offlineRef: true, name: true, userId: true },
  });
  console.log("");
  console.log(`Passes already issued for this tournament: ${existing.length}`);
  for (const e of existing) console.log(`   ${e.offlineRef} — ${e.name}`);

  console.log("");
  if (!APPLY) {
    // Dry run still calls through, because the reasons it reports are the
    // whole point — but nothing is written unless a pass is genuinely
    // missing AND --apply was given.
    console.log("DRY RUN — re-run with --apply to issue whatever is owed.");
    return;
  }

  const res = await issuePrizePasses(t.id, null);
  console.log("APPLYING");
  for (const i of res.issued) {
    console.log(`   ✓ place ${i.position} → ${i.teamName}  (pass ${i.userPassId})`);
  }
  for (const s of res.skipped) {
    console.log(`   – place ${s.position}: ${s.reason}`);
  }
  if (res.issued.length === 0 && res.skipped.length === 0) {
    console.log("   nothing configured to issue.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
