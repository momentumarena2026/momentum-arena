// One-shot: create (or refresh) the PICKLEBALL25 launch coupon.
//
// What it builds:
//   - 25% off (2500 basis points), PERCENTAGE
//   - Scope: SPORTS, sportFilter: [PICKLEBALL]
//   - maxUses: null            → unlimited total uses (no global cap)
//   - maxUsesPerUser: 1_000_000 → effectively unlimited per user. The
//     schema requires min 1 so we use a large sentinel rather than
//     introducing a special "0 = unlimited" semantic that the
//     validator (coupon-validation.ts:94) doesn't understand.
//   - validUntil: 2099-12-31   → admin disables via isActive when the
//     promo ends, not by waiting for the date to expire.
//   - isStackable: false       → mirrors FLAT100; we don't want this
//     stacking with new-user / referral codes by accident.
//   - isPublic: true           → shows on the customer coupon page.
//   - isSystemCode: false      → it IS auto-applied by the checkout
//     client (see checkout-client.tsx / CheckoutScreen.tsx), but the
//     system-code flag is reserved for new-user / referral codes that
//     go through getNewUserDiscount(). Keeping this false avoids
//     accidentally tripping that path.
//
// Idempotent: an existing row keyed on `code = PICKLEBALL25` is
// updated in place; admin edits on fields NOT listed in `update:`
// are preserved (today: createdBy, validFrom, conditions, eligible*).
//
// Usage (production):
//   DATABASE_URL=$PRODUCTION_DB_URL npx tsx scripts/seed-pickleball25-coupon.ts
//
// Or via the dedicated workflow at .github/workflows/seed-pickleball-coupon.yml
// (workflow_dispatch — runs against the PRODUCTION_DB_URL secret).

import { db } from "../lib/db";

const CODE = "PICKLEBALL25";
const VALUE_BPS = 2500; // 25% in basis points (10000 = 100%)
const UNLIMITED_PER_USER = 1_000_000;
const FAR_FUTURE = new Date("2099-12-31T23:59:59Z");

async function main() {
  // Need an admin userId for `createdBy`. The seed-production workflow
  // always provisions the `gamelord` superadmin first, so this is safe
  // to look up. If it's missing we error out loudly rather than fall
  // back to a fake id — that would create an orphaned audit trail.
  const superadmin = await db.adminUser.findUnique({
    where: { username: "gamelord" },
    select: { id: true },
  });
  if (!superadmin) {
    throw new Error(
      "Expected superadmin `gamelord` to exist (provisioned by prisma/seed.ts). " +
        "Run the seed-production workflow first.",
    );
  }

  const existing = await db.coupon.findUnique({ where: { code: CODE } });

  if (existing) {
    await db.coupon.update({
      where: { code: CODE },
      data: {
        description: "Flat 25% off every pickleball slot — Launch promo",
        scope: "SPORTS",
        type: "PERCENTAGE",
        value: VALUE_BPS,
        maxDiscount: null, // no cap — 25% of any pickleball slot
        maxUses: null, // unlimited total uses
        maxUsesPerUser: UNLIMITED_PER_USER,
        minAmount: null,
        sportFilter: ["PICKLEBALL"],
        categoryFilter: [],
        categoryExclude: [],
        userGroupFilter: [],
        isStackable: false,
        stackGroup: null,
        isPublic: true,
        isSystemCode: false,
        validUntil: FAR_FUTURE,
        isActive: true,
      },
    });
    console.log(`Updated existing coupon ${CODE} (id=${existing.id}).`);
    return;
  }

  const created = await db.coupon.create({
    data: {
      code: CODE,
      description: "Flat 25% off every pickleball slot — Launch promo",
      scope: "SPORTS",
      type: "PERCENTAGE",
      value: VALUE_BPS,
      maxDiscount: null,
      maxUses: null,
      maxUsesPerUser: UNLIMITED_PER_USER,
      minAmount: null,
      sportFilter: ["PICKLEBALL"],
      categoryFilter: [],
      categoryExclude: [],
      userGroupFilter: [],
      isStackable: false,
      stackGroup: null,
      isPublic: true,
      isSystemCode: false,
      validFrom: new Date(),
      validUntil: FAR_FUTURE,
      isActive: true,
      createdBy: superadmin.id,
    },
  });
  console.log(`Created coupon ${CODE} (id=${created.id}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
