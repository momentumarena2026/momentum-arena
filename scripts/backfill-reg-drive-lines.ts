/**
 * Give existing tournaments their registration-drive copy.
 *
 * `draftCampaign` runs once, when a tournament is created, so every
 * tournament that already existed when the drive shipped has none of
 * its lines — including the one that is open for registration right
 * now. Without this the cron would wake up each hour, find no enabled
 * lines, refuse with "every line in this drive is switched off", and be
 * correct about it.
 *
 * Idempotent and additive: it only inserts the drive lines a tournament
 * is missing, matched by title, and never touches an existing row. A
 * line the venue has rewritten or switched off stays rewritten or
 * switched off.
 *
 * Scoped to tournaments that could still use a drive — anything not yet
 * past registration. Back-filling copy onto a tournament that finished
 * in August would be noise on its Campaign tab forever.
 *
 *   npx tsx scripts/backfill-reg-drive-lines.ts
 *   npx tsx scripts/backfill-reg-drive-lines.ts --dry-run
 *   npx tsx scripts/backfill-reg-drive-lines.ts --allow-production   # CI only
 */
import { PrismaClient } from "@prisma/client";
import { REG_DRIVE_LINES } from "../lib/tournament-campaign";

const db = new PrismaClient();
const PRODUCTION_ENDPOINT = "ep-dark-hat-ampi5dah";
const DRY_RUN = process.argv.includes("--dry-run");

/** Statuses where a registration drive could still be wanted. */
const LIVE_ENOUGH = ["DRAFT", "PUBLISHED", "REG_OPEN"] as const;

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
  console.log(`database: ${url.match(/@([^/?]+)/)?.[1] ?? "unknown"}`);
  if (DRY_RUN) console.log("DRY RUN — nothing will be written\n");

  const tournaments = await db.tournament.findMany({
    where: { status: { in: [...LIVE_ENOUGH] } },
    select: {
      id: true,
      slug: true,
      name: true,
      sport: true,
      status: true,
      entryFee: true,
      prizePool: true,
      bannerImageUrl: true,
      regDriveEnabled: true,
      regDriveHourIST: true,
      totalTeams: true,
    },
  });

  if (tournaments.length === 0) {
    console.log("No tournaments are at or before registration — nothing to do.");
    return;
  }

  for (const t of tournaments) {
    const present = new Set(
      (
        await db.tournamentCampaignItem.findMany({
          where: { tournamentId: t.id, recurring: true },
          select: { title: true },
        })
      ).map((r) => r.title),
    );

    const wanted = REG_DRIVE_LINES.map((m) => ({
      tournamentId: t.id,
      milestone: m.milestone,
      kind: m.kind,
      title: m.title(t),
      body: m.body(t),
      enabled: true,
      status: "DRAFT",
      recurring: true,
    }));
    const toAdd = wanted.filter((w) => !present.has(w.title));

    if (toAdd.length > 0 && !DRY_RUN) {
      await db.tournamentCampaignItem.createMany({ data: toAdd });
    }

    const confirmed = await db.tournamentTeam.count({
      where: { tournamentId: t.id, status: "CONFIRMED" },
    });
    console.log(
      `${t.name}  [${t.status}]  ${confirmed}/${t.totalTeams} confirmed\n` +
        `  drive ${t.regDriveEnabled ? `ON at ${t.regDriveHourIST}:00 IST` : "OFF"} · ` +
        `added ${toAdd.length}, ${present.size} already present`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
