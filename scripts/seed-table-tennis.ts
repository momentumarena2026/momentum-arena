/**
 * Stand up the table-tennis court.
 *
 * ── THE ONE THING THAT MATTERS ────────────────────────────────────────
 * Table tennis is played on the PICKLEBALL COURT. It is not a second
 * court; it is a second thing you can do with the same floor. The whole
 * correctness of this rests on both configs listing the same
 * `SHARED_COURT` zone, because `zonesOverlap()` is what stops two
 * bookings being sold the same hour — the same mechanism that already
 * stops the football field being sold while the cricket one is booked.
 *
 * Give table tennis a zone of its own and the court becomes sellable
 * twice over at the same moment, to two different customers, with
 * nothing reporting it until both of them turn up. The script refuses
 * to finish if that invariant does not hold, and
 * tests/sport-parity.test.ts asserts it at build time.
 *
 * ── PRICES ARE COPIED, NOT TYPED ──────────────────────────────────────
 * The venue said "same as pickleball", so the script READS pickleball's
 * live PricingRule rows and clones them. Typing the figures in would
 * have made this correct on the day and wrong the first time anybody
 * repriced pickleball — and wrong differently on staging and
 * production, which already hold different numbers.
 *
 * Idempotent. Re-running updates the court in place and re-syncs the
 * prices from pickleball, which is also how you apply a pickleball
 * price change to table tennis: run it again.
 *
 *   npx tsx scripts/seed-table-tennis.ts --dry-run
 *   npx tsx scripts/seed-table-tennis.ts --allow-production
 */
import { PrismaClient } from "@prisma/client";
import { DEFAULT_DAILY_PUSH_LINES } from "../lib/daily-push-library";

const db = new PrismaClient();
const PRODUCTION_ENDPOINT = "ep-dark-hat-ampi5dah";
const DRY_RUN = process.argv.includes("--dry-run");

const LABEL = "Table Tennis Court";

/** Occasion tag carried by the launch push lines. */
const LAUNCH_TAG = "table-tennis-launch";
/** How long the launch run lasts, in days, starting the day it is seeded. */
const LAUNCH_DAYS = 14;

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

  // ── The court we are copying ────────────────────────────────────────
  const pickleball = await db.courtConfig.findFirst({
    where: { sport: "PICKLEBALL", isActive: true },
    select: {
      id: true,
      size: true,
      position: true,
      widthFt: true,
      lengthFt: true,
      zones: true,
      slotDurationMinutes: true,
      maxPassMembers: true,
      prices: { select: { dayType: true, timeType: true, pricePerSlot: true } },
    },
  });
  if (!pickleball) {
    throw new Error(
      "No active PICKLEBALL court found. Table tennis is defined as 'the pickleball court, " +
        "different sport', so there is nothing coherent to copy and nothing to share a zone with.",
    );
  }
  console.log(
    `copying pickleball: ${pickleball.widthFt}x${pickleball.lengthFt}ft, ` +
      `zones [${pickleball.zones.join(", ")}], ${pickleball.slotDurationMinutes}min slots, ` +
      `${pickleball.prices.length} price rows\n`,
  );

  const existing = await db.courtConfig.findFirst({
    where: { sport: "TABLE_TENNIS" },
    select: { id: true },
  });

  const shape = {
    sport: "TABLE_TENNIS" as const,
    size: pickleball.size,
    label: LABEL,
    position: pickleball.position,
    widthFt: pickleball.widthFt,
    lengthFt: pickleball.lengthFt,
    // THE line. Same zones as pickleball — see the note at the top.
    zones: pickleball.zones,
    slotDurationMinutes: pickleball.slotDurationMinutes,
    maxPassMembers: pickleball.maxPassMembers,
    category: null,
    isActive: true,
  };

  if (DRY_RUN) {
    console.log(`${existing ? "WOULD UPDATE" : "WOULD CREATE"} ${LABEL}`);
    for (const p of pickleball.prices) {
      console.log(`  ${p.dayType} ${p.timeType}: ₹${p.pricePerSlot}`);
    }
    return;
  }

  const courtId = existing
    ? (await db.courtConfig.update({ where: { id: existing.id }, data: shape, select: { id: true } })).id
    : (await db.courtConfig.create({ data: shape, select: { id: true } })).id;

  // Prices are REPLACED rather than appended: two rules for the same
  // (dayType, timeType) is an ambiguity the pricing lookup resolves
  // arbitrarily, so a stale row from an earlier run could quietly win.
  await db.pricingRule.deleteMany({ where: { courtConfigId: courtId } });
  await db.pricingRule.createMany({
    data: pickleball.prices.map((p) => ({
      courtConfigId: courtId,
      dayType: p.dayType,
      timeType: p.timeType,
      pricePerSlot: p.pricePerSlot,
    })),
  });

  // ── Verify, rather than trust the writes ────────────────────────────
  const check = await db.courtConfig.findUnique({
    where: { id: courtId },
    select: {
      id: true, sport: true, label: true, zones: true, isActive: true,
      slotDurationMinutes: true, maxPassMembers: true,
      prices: { select: { dayType: true, timeType: true, pricePerSlot: true } },
    },
  });

  const shared = check!.zones.filter((z) => pickleball.zones.includes(z));
  console.log(`${existing ? "Updated" : "Created"} ${LABEL} (id=${courtId})`);
  console.log(`  zones    : [${check!.zones.join(", ")}]`);
  console.log(`  shares   : [${shared.join(", ")}] with the pickleball court`);
  console.log(`  slots    : ${check!.slotDurationMinutes} min · pass members ${check!.maxPassMembers}`);
  for (const p of check!.prices.sort((a, b) => `${a.dayType}${a.timeType}`.localeCompare(`${b.dayType}${b.timeType}`))) {
    console.log(`  ₹${p.pricePerSlot}  ${p.dayType} ${p.timeType}`);
  }

  if (shared.length === 0) {
    throw new Error(
      "The table-tennis court shares NO zone with the pickleball court. The same floor " +
        "would be sellable twice over at the same hour. Refusing to report success.",
    );
  }
  const missing = pickleball.prices.length - check!.prices.length;
  if (missing !== 0) {
    throw new Error(`Expected ${pickleball.prices.length} price rows, found ${check!.prices.length}.`);
  }
  // ── The launch push run ─────────────────────────────────────────────
  //
  // Dated from TODAY rather than from a constant, because "the day
  // table tennis goes live" is the day somebody runs this — a hardcoded
  // start date would be wrong the moment the deploy slipped by a day,
  // and the failure is silent: the lines carry a tag whose window has
  // not opened, so nothing goes out and nothing says why.
  const launchLines = DEFAULT_DAILY_PUSH_LINES.filter((l) =>
    (l.tags ?? []).includes(LAUNCH_TAG),
  );
  if (launchLines.length === 0) {
    throw new Error(`No lines tagged "${LAUNCH_TAG}" in the library — the launch run would be silent.`);
  }

  const today = new Date();
  const istToday = new Date(today.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const endsOn = new Date(
    new Date(`${istToday}T00:00:00.000Z`).getTime() + (LAUNCH_DAYS - 1) * 86400_000,
  )
    .toISOString()
    .slice(0, 10);

  const existingWindow = await db.dailyPushOccasion.findFirst({
    where: { tag: LAUNCH_TAG },
    select: { id: true },
  });
  const windowData = {
    tag: LAUNCH_TAG,
    label: "Table tennis launch",
    // @db.Date takes the IST CALENDAR DATE and nothing else — gotcha 19.
    startsOn: new Date(`${istToday}T00:00:00.000Z`),
    endsOn: new Date(`${endsOn}T00:00:00.000Z`),
  };
  if (existingWindow) {
    await db.dailyPushOccasion.update({ where: { id: existingWindow.id }, data: windowData });
  } else {
    await db.dailyPushOccasion.create({ data: windowData });
  }

  const presentLines = new Set(
    (
      await db.dailyPushLine.findMany({
        where: { title: { in: DEFAULT_DAILY_PUSH_LINES.map((l) => l.title) } },
        select: { title: true },
      })
    ).map((r) => r.title),
  );
  const newLines = DEFAULT_DAILY_PUSH_LINES.filter((l) => !presentLines.has(l.title));
  if (newLines.length > 0) {
    await db.dailyPushLine.createMany({
      data: newLines.map((l) => ({ title: l.title, body: l.body, tags: l.tags ?? [] })),
    });
  }

  console.log(
    `\npush: ${existingWindow ? "updated" : "created"} window "${LAUNCH_TAG}" ` +
      `${istToday} → ${endsOn} (${LAUNCH_DAYS} days, IST)`,
  );
  console.log(`      ${launchLines.length} launch lines · added ${newLines.length} new library rows`);
  for (const l of launchLines) console.log(`      · ${l.title} — ${l.body}`);

  console.log("\nverified: same floor, same prices, one bookable hour between them");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
