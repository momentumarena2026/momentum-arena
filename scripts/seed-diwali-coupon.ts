/**
 * One-shot: create (or refresh) the DIWALI1500 bumper coupon.
 *
 * ONE PRICE, ALL DAY: ₹1500 per hour for CRICKET and FOOTBALL on every
 * slot PLAYED 1–11 Nov 2026 (IST, inclusive). Auto-applied, peak and
 * off-peak alike. That flattening is the whole offer — the full turf is
 * otherwise ₹2000 from 17:00 and ₹1600 before it.
 *
 * ── WHY THIS IS A TARGET_PRICE AND NOT A PERCENTAGE ───────────────────
 * A flat rate needs ₹500 off the peak hour and ₹100 off the off-peak
 * one. No single percentage or flat amount does both, so neither of the
 * two older discount types can express "one price". TARGET_PRICE prices
 * per slot — see the enum comment in prisma/schema.prisma.
 *
 * ── WHY THERE IS NO COURT-SIZE FILTER, AND NONE IS NEEDED ─────────────
 * A coupon can filter by sport and exclude a sub-category, but it cannot
 * say "full field only". It does not have to here, because TARGET_PRICE
 * floors its saving at zero PER SLOT: a slot already at or below ₹1500
 * gets nothing. So the offer lands on the full turf (₹2000 / ₹1600) and
 * leaves every cheaper configuration — the ₹1300–1500 large centre, the
 * ₹1000–1200 half courts, the ₹500–800 leather pitches — untouched,
 * rather than RAISING them to ₹1500, which is what a literal "one price
 * for cricket and football" would have done. The seeder prints the
 * resulting price for every court and band so this is checked against
 * the live PricingRule table rather than assumed.
 *
 * ── THE PART THAT IS EASY TO GET WRONG ────────────────────────────────
 * Two date windows do two different jobs:
 *
 *   validFrom / validUntil   WHEN the coupon may be redeemed.
 *   BOOKING_DATE condition   WHICH DAY is being played.
 *
 * Redemption opens IMMEDIATELY so bookings made before 1 Nov carry the
 * rate too — which is most of them, two days out. Setting validFrom to
 * 1 Nov would read correctly and quietly refuse every advance booking.
 * `validUntil` is the end of 11 Nov: after that no playable date remains
 * in the window.
 *
 * No TIME_WINDOW condition, deliberately: "all day" means no hour
 * restriction, and the ABSENCE of the condition is the instruction. One
 * scoped to all 24 hours would look equivalent and would start refusing
 * the arena's late-night slots, which legitimately run into hour 25.
 *
 * The bowling machine is excluded. It is a CRICKET court carrying
 * category BOWLING_MACHINE, so `sportFilter` alone sweeps it in; at ₹250
 * a half hour the target-price floor would ignore it anyway, but the
 * exclusion is kept explicit so the coupon reads the same way FLAT100
 * and NAVRATRI25 do and does not start discounting it if that rate ever
 * rises above ₹1500.
 *
 * Idempotent. Re-running updates the coupon in place AND re-syncs the
 * date condition. If the dates were ever entered wrongly, fix the
 * constants in lib/diwali-2026.ts and run it again.
 *
 *   DATABASE_URL=... npx tsx scripts/seed-diwali-coupon.ts --dry-run
 *   DATABASE_URL=... npx tsx scripts/seed-diwali-coupon.ts
 *   npx tsx scripts/seed-diwali-coupon.ts --allow-production   # CI only
 */
import { PrismaClient } from "@prisma/client";
import {
  DIWALI_DISCOUNT_FROM,
  DIWALI_DISCOUNT_TO,
  DIWALI_FLAT_RATE,
} from "../lib/diwali-2026";

const db = new PrismaClient();

const CODE = "DIWALI1500";
const PRODUCTION_ENDPOINT = "ep-dark-hat-ampi5dah";
const UNLIMITED_PER_USER = 1_000_000;

/** Last moment the coupon can be redeemed: end of the final play date, IST. */
const VALID_UNTIL = new Date(`${DIWALI_DISCOUNT_TO}T23:59:59+05:30`);

const DESCRIPTION = `Diwali Bumper — cricket & football at ₹${DIWALI_FLAT_RATE}/hour, all day, played 1–11 Nov 2026`;

const DRY_RUN = process.argv.includes("--dry-run");
const SPORTS = ["CRICKET", "FOOTBALL"] as const;

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("DATABASE_URL is not set.");
  const isProduction = url.includes(PRODUCTION_ENDPOINT);
  if (isProduction && !DRY_RUN && !process.argv.includes("--allow-production")) {
    throw new Error(
      "REFUSING TO RUN: that is the PRODUCTION branch. Pass --allow-production if you mean it.",
    );
  }
  console.log(`database: ${url.match(/@([^/?]+)/)?.[1] ?? "unknown"}`);
  if (DRY_RUN) console.log("DRY RUN — nothing will be written");
  console.log("");

  // ── What the offer actually does to the live price table ────────────
  //
  // Printed BEFORE anything is written, because this is the check that
  // the number the push copy quotes is a discount at all. A rate above
  // every court's price would seed a coupon that silently does nothing
  // while twelve push notifications advertise it.
  const configs = await db.courtConfig.findMany({
    where: { sport: { in: [...SPORTS] }, isActive: true },
    select: {
      sport: true,
      label: true,
      category: true,
      prices: { select: { dayType: true, timeType: true, pricePerSlot: true } },
    },
    orderBy: [{ sport: "asc" }, { label: "asc" }],
  });

  console.log(`what ₹${DIWALI_FLAT_RATE}/slot does to each court:\n`);
  let discounted = 0;
  for (const c of configs) {
    const excluded = c.category === "BOWLING_MACHINE";
    // One line per distinct price, not per rule: weekday and weekend
    // are identical across this table, so four rules are two prices.
    const bands = [...new Set(c.prices.map((p) => `${p.timeType}:${p.pricePerSlot}`))]
      .map((k) => {
        const [timeType, raw] = k.split(":");
        const price = Number(raw);
        const pays = excluded ? price : Math.min(price, DIWALI_FLAT_RATE);
        const saving = price - pays;
        if (saving > 0) discounted++;
        return `${timeType === "PEAK" ? "peak " : "day  "} ₹${price} → ₹${pays}${
          saving > 0 ? `  (−₹${saving})` : excluded ? "  excluded" : "  unchanged"
        }`;
      })
      .sort();
    console.log(`  ${c.sport} · ${c.label}`);
    for (const b of bands) console.log(`      ${b}`);
  }
  console.log("");
  if (discounted === 0) {
    throw new Error(
      `₹${DIWALI_FLAT_RATE} is at or above every cricket/football price, so this coupon would ` +
        `discount nothing while the push campaign advertises it. Check DIWALI_FLAT_RATE against ` +
        `the table above.`,
    );
  }
  console.log(`${discounted} price band(s) actually come down. ✓\n`);

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
    type: "TARGET_PRICE" as const,
    value: DIWALI_FLAT_RATE, // the price PAID per slot, not an amount off
    maxDiscount: null, // no cap — every hour comes down to the flat rate
    maxUses: null, // unlimited total
    maxUsesPerUser: UNLIMITED_PER_USER,
    minAmount: null,
    sportFilter: [...SPORTS],
    categoryFilter: [],
    categoryExclude: ["BOWLING_MACHINE"] as ["BOWLING_MACHINE"],
    userGroupFilter: [],
    validPlatforms: [], // web and app alike
    isStackable: false, // must not compound with welcome or referral codes
    stackGroup: null,
    isPublic: true,
    isSystemCode: false,
    autoApply: true, // applied at checkout without anybody typing a code
    // Deliberately OFF. The slot tiles are drawn without a play date, so
    // a strikethrough here would advertise ₹1500 on every date in the
    // calendar — including ones checkout charges ₹2000 for. See the
    // TARGET_PRICE guard in actions/sport-promo.ts. NAVRATRI25 shipped
    // the same way; the discount shows at checkout.
    showStrikethrough: false,
    validUntil: VALID_UNTIL,
    isActive: true,
  };

  const existing = await db.coupon.findUnique({
    where: { code: CODE },
    select: { id: true },
  });

  if (DRY_RUN) {
    console.log(`WOULD ${existing ? "UPDATE" : "CREATE"} ${CODE}`);
    console.log(`  ₹${DIWALI_FLAT_RATE}/slot on ${shared.sportFilter.join(" + ")}, all hours`);
    console.log(`  excluding  : ${shared.categoryExclude.join(", ")}`);
    console.log(`  play dates : ${DIWALI_DISCOUNT_FROM} → ${DIWALI_DISCOUNT_TO} (IST, inclusive)`);
    console.log(`  redeemable : now → ${VALID_UNTIL.toISOString()}`);
    console.log(`  autoApply  : ${shared.autoApply}, strikethrough: ${shared.showStrikethrough}`);
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
            // Opens immediately so advance bookings for the window qualify.
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
      conditionValue: JSON.stringify({
        from: DIWALI_DISCOUNT_FROM,
        to: DIWALI_DISCOUNT_TO,
      }),
    },
  });

  const check = await db.coupon.findUnique({
    where: { id },
    select: {
      code: true,
      type: true,
      value: true,
      sportFilter: true,
      autoApply: true,
      showStrikethrough: true,
      isActive: true,
      categoryExclude: true,
      validFrom: true,
      validUntil: true,
      conditions: { select: { conditionType: true, conditionValue: true } },
    },
  });
  console.log(`${existing ? "Updated" : "Created"} ${CODE} (id=${id})`);
  console.log(`  ${check!.type} ₹${check!.value}/slot on ${check!.sportFilter.join(" + ")}, all hours`);
  console.log(`  excluding  : ${check!.categoryExclude.join(", ") || "nothing"}`);
  console.log(
    `  autoApply=${check!.autoApply} strikethrough=${check!.showStrikethrough} active=${check!.isActive}`,
  );
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
