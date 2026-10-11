/**
 * Clear a tournament's registration-drive send history, resetting the
 * per-person streak cap.
 *
 * ── WHY THIS WAS NEEDED ONCE ──────────────────────────────────────────
 * The drive refuses anyone it has already asked on `maxConsecutiveDays`
 * days running (3). That budget is spent on sends, not on good sends —
 * and the first two days of the Momentum October Cup drive went out
 * with copy the venue then withdrew, because it named the exact number
 * of unfilled spots. Left alone, the replacement copy would have
 * reached those 53 people exactly once before the cap silenced the
 * drive for the remaining nine days of registration.
 *
 * Deleting the send rows gives the new copy the full run of three the
 * cap was meant to allow.
 *
 * ── WHAT THIS DOES NOT TOUCH ──────────────────────────────────────────
 * Nothing about money, bookings, teams or registrations. These rows
 * exist only to answer "have we already asked this person, and how
 * many days running?". The campaign items keep their own rotation
 * state separately (`sentAt` / `useCount` on TournamentCampaignItem).
 *
 * ── THE ONE REAL RISK, AND WHY IT IS NOT LIVE HERE ────────────────────
 * These rows are also the idempotency guard: deleting TODAY's would let
 * the drive message the same people a second time if the send hour came
 * round again before midnight IST. It cannot — the hour comes once a
 * day — but the script still refuses to clear today's rows unless asked
 * in as many words, because "it cannot happen" is a worse guarantee
 * than "it is not permitted".
 *
 *   npx tsx scripts/reset-reg-drive-streak.ts --slug=momentum-october-cup --dry-run
 *   npx tsx scripts/reset-reg-drive-streak.ts --slug=momentum-october-cup --allow-production
 *   ... --include-today      also clears today's rows (see above)
 */
import { PrismaClient } from "@prisma/client";
import { istDayKey } from "../lib/daily-push-rules";

const db = new PrismaClient();
const PRODUCTION_ENDPOINT = "ep-dark-hat-ampi5dah";
const DRY_RUN = process.argv.includes("--dry-run");
const INCLUDE_TODAY = process.argv.includes("--include-today");
const SLUG = process.argv.find((a) => a.startsWith("--slug="))?.slice("--slug=".length);

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (
    url.includes(PRODUCTION_ENDPOINT) &&
    !DRY_RUN &&
    !process.argv.includes("--allow-production")
  ) {
    throw new Error(
      "REFUSING TO RUN: that is the PRODUCTION branch. Pass --allow-production if you mean it.",
    );
  }
  if (!SLUG) {
    throw new Error(
      "Pass --slug=<tournament-slug>. There is no 'all tournaments' mode: clearing every drive's " +
        "history at once is never a thing somebody means to do.",
    );
  }
  console.log(`database: ${url.match(/@([^/?]+)/)?.[1] ?? "unknown"}`);
  if (DRY_RUN) console.log("DRY RUN — nothing will be written\n");

  const t = await db.tournament.findUnique({
    where: { slug: SLUG },
    select: { id: true, name: true, status: true, regDriveHourIST: true },
  });
  if (!t) throw new Error(`No tournament with slug "${SLUG}".`);

  const today = istDayKey(new Date());
  const where = {
    tournamentId: t.id,
    ...(INCLUDE_TODAY ? {} : { sentOn: { lt: today } }),
  };

  const rows = await db.tournamentRegDriveSend.groupBy({
    by: ["sentOn"],
    where,
    _count: { _all: true },
    orderBy: { sentOn: "asc" },
  });

  if (rows.length === 0) {
    console.log(`${t.name}: no send history to clear.`);
    return;
  }

  console.log(`${t.name} [${t.status}] — drive history:`);
  for (const r of rows) {
    console.log(`  ${r.sentOn.toISOString().slice(0, 10)}  ${r._count._all} people`);
  }
  if (!INCLUDE_TODAY) {
    const todayCount = await db.tournamentRegDriveSend.count({
      where: { tournamentId: t.id, sentOn: today },
    });
    if (todayCount > 0) {
      console.log(
        `  ${today.toISOString().slice(0, 10)}  ${todayCount} people  — KEPT (today's idempotency guard; pass --include-today to clear)`,
      );
    }
  }

  if (DRY_RUN) {
    const n = rows.reduce((a, r) => a + r._count._all, 0);
    console.log(`\nwould delete ${n} row(s) across ${rows.length} day(s)`);
    return;
  }

  const del = await db.tournamentRegDriveSend.deleteMany({ where });
  console.log(`\ndeleted ${del.count} row(s) across ${rows.length} day(s)`);

  const left = await db.tournamentRegDriveSend.count({ where: { tournamentId: t.id } });
  console.log(
    `${left} row(s) remain for this tournament — ` +
      `everyone's streak is now ${left === 0 ? "0" : "counted from those"}, ` +
      `so the next send hour (${t.regDriveHourIST}:00 IST) reaches them again.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
