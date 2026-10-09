/**
 * One-shot: create (or refresh) the NAVRATRI25 festival coupon.
 *
 * 25% off CRICKET and FOOTBALL for every slot PLAYED during the nine
 * days of Shardiya Navratri 2026 — Sun 11 Oct to Mon 19 Oct, IST,
 * inclusive. Auto-applied, all hours, peak and off-peak alike. The
 * BOWLING MACHINE is excluded (see `categoryExclude` below — it is a
 * cricket court, so the sport filter alone would have included it).
 *
 * ── THE PART THAT IS EASY TO GET WRONG ────────────────────────────────
 * Two different date windows do two different jobs, and conflating them
 * breaks the venue's actual requirement:
 *
 *   validFrom / validUntil   WHEN the coupon may be redeemed.
 *   BOOKING_DATE condition   WHICH DAY is being played.
 *
 * The venue asked for bookings made BEFORE Navratri starts to carry the
 * discount too. So redemption opens immediately and the nine days live
 * in the condition, not in validFrom. Setting validFrom to the first day
 * of Navratri would have read correctly and quietly refused every
 * advance booking — which is most of them, two days out.
 *
 * `validUntil` is the end of the last Navratri day: after that there is
 * no playable date left in the window, so the coupon has nothing it
 * could legitimately discount.
 * ──────────────────────────────────────────────────────────────────────
 *
 * No TIME_WINDOW condition, deliberately: "both peak and non-peak" means
 * no hour restriction at all, and the absence of the condition IS the
 * instruction. Adding one scoped to all 24 hours would look equivalent
 * and would silently start rejecting the arena's late-night slots, which
 * legitimately run past midnight into hour 24 and 25.
 *
 * Idempotent. Re-running updates the coupon in place AND re-syncs the
 * date condition — unlike the launch-promo seeds, which have no
 * condition to drift. If the nine days were ever entered wrongly, the
 * fix is to correct the constants here and run it again.
 *
 * Usage:
 *   DATABASE_URL=$STAGING_DB_URL npx tsx scripts/seed-navratri-coupon.ts
 *   npx tsx scripts/seed-navratri-coupon.ts --dry-run    # print, write nothing
 *
 * Or via .github/workflows/seed-navratri-coupon.yml (workflow_dispatch).
 */
import { db } from "../lib/db";

const CODE = "NAVRATRI25";
const VALUE_BPS = 2500; // 25% in basis points (10000 = 100%)
const UNLIMITED_PER_USER = 1_000_000;

/**
 * Shardiya Navratri 2026, verified against published panchang rather
 * than recalled: Ghatasthapana Sun 11 Oct, ninth day Mon 19 Oct.
 * Vijayadashami falls on Tue 20 Oct and is NOT included — the venue
 * asked for the nine days.
 *
 * These are lunar and move every year. A later festival needs these two
 * constants changed and the script re-run; nothing here infers them.
 */
const PLAY_FROM = "2026-10-11";
const PLAY_TO = "2026-10-19";

/** Last moment the coupon can be redeemed: end of the final Navratri day, IST. */
const VALID_UNTIL = new Date("2026-10-19T23:59:59+05:30");

const DESCRIPTION =
  "Navratri — 25% off cricket & football played 11–19 Oct 2026";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/?]+)/)?.[1] ?? "unknown";
  console.log(`database: ${host}`);
  console.log(`${DRY_RUN ? "DRY RUN — nothing will be written\n" : ""}`);

  // `createdBy` needs a real admin. prisma/seed.ts provisions `gamelord`
  // on every environment, so this is safe — and erroring out beats
  // inventing an id and orphaning the audit trail.
  const superadmin = await db.adminUser.findUnique({
    where: { username: "gamelord" },
    select: { id: true },
  });
  if (!superadmin) {
    throw new Error(
      "Expected superadmin `gamelord` to exist (provisioned by prisma/seed.ts). " +
        "Run the seed workflow for this environment first.",
    );
  }

  const shared = {
    description: DESCRIPTION,
    scope: "SPORTS" as const,
    type: "PERCENTAGE" as const,
    value: VALUE_BPS,
    maxDiscount: null, // no cap — a full 25% off whatever the slot costs
    maxUses: null, // unlimited total
    maxUsesPerUser: UNLIMITED_PER_USER,
    minAmount: null,
    sportFilter: ["CRICKET", "FOOTBALL"] as ("CRICKET" | "FOOTBALL")[],
    categoryFilter: [],
    // The bowling machine is NOT a separate sport — it is a CRICKET court
    // carrying category BOWLING_MACHINE, so `sportFilter` alone sweeps it
    // in. It is a ₹250 flat-rate net, priced nothing like a ₹1600–2000
    // box, and the venue has already taken this position once: FLAT100,
    // the live cricket+football welcome discount, excludes it too. A
    // festival discount on the boxes is not a discount on the machine.
    categoryExclude: ["BOWLING_MACHINE"] as ["BOWLING_MACHINE"],
    userGroupFilter: [],
    validPlatforms: [], // web and app alike
    isStackable: false, // must not compound with welcome or referral codes
    stackGroup: null,
    isPublic: true,
    isSystemCode: false,
    autoApply: true, // applied at checkout without anybody typing a code
    validUntil: VALID_UNTIL,
    isActive: true,
  };

  const existing = await db.coupon.findUnique({
    where: { code: CODE },
    select: { id: true, validFrom: true },
  });

  if (DRY_RUN) {
    console.log(`${existing ? "WOULD UPDATE" : "WOULD CREATE"} ${CODE}`);
    console.log(`  25% off ${shared.sportFilter.join(" + ")}, all hours`);
    console.log(`  excluding  : ${shared.categoryExclude.join(", ")}`);
    console.log(`  play dates : ${PLAY_FROM} → ${PLAY_TO} (IST, inclusive)`);
    console.log(`  redeemable : now → ${VALID_UNTIL.toISOString()}`);
    console.log(`  autoApply  : ${shared.autoApply}`);
    await db.$disconnect();
    return;
  }

  const id = existing
    ? (
        await db.coupon.update({
          where: { code: CODE },
          // validFrom is NOT in the update set: re-running must not push
          // the redemption window forward and strand bookings already
          // made against it.
          data: shared,
          select: { id: true },
        })
      ).id
    : (
        await db.coupon.create({
          data: {
            ...shared,
            code: CODE,
            // Opens immediately so advance bookings for Navratri qualify.
            validFrom: new Date(),
            createdBy: superadmin.id,
          },
          select: { id: true },
        })
      ).id;

  // Re-sync the play-date window. Replaced rather than appended: two
  // BOOKING_DATE rows would both have to pass, so a stale one from an
  // earlier run would silently narrow the promo to nothing.
  await db.couponCondition.deleteMany({
    where: { couponId: id, conditionType: "BOOKING_DATE" },
  });
  await db.couponCondition.create({
    data: {
      couponId: id,
      conditionType: "BOOKING_DATE",
      conditionValue: JSON.stringify({ from: PLAY_FROM, to: PLAY_TO }),
    },
  });

  const check = await db.coupon.findUnique({
    where: { id },
    select: {
      code: true,
      value: true,
      sportFilter: true,
      autoApply: true,
      isActive: true,
      categoryExclude: true,
      validFrom: true,
      validUntil: true,
      conditions: { select: { conditionType: true, conditionValue: true } },
    },
  });
  console.log(`${existing ? "Updated" : "Created"} ${CODE} (id=${id})`);
  console.log(`  ${check!.value / 100}% off ${check!.sportFilter.join(" + ")}, all hours`);
  console.log(`  excluding  : ${check!.categoryExclude.join(", ") || "nothing"}`);
  console.log(`  autoApply=${check!.autoApply} active=${check!.isActive}`);
  console.log(`  redeemable : ${check!.validFrom.toISOString()} → ${check!.validUntil.toISOString()}`);
  for (const c of check!.conditions) {
    console.log(`  condition  : ${c.conditionType} ${c.conditionValue}`);
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
