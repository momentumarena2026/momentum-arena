// One-shot: create the APPFIRST "first app booking" welcome coupon.
//
// This is the code the MOBILE checkout auto-attempts first (see
// lib/auto-apply-promo.ts:APP_FIRST_BOOKING_CODE + CheckoutScreen.tsx).
// validateCoupon enforces eligibility, so it only ever discounts a
// customer's genuine first app booking, on the app.
//
// What it builds (sensible defaults — TUNE IN ADMIN before going live):
//   - 20% off (2000 bps), PERCENTAGE, capped at ₹150 (maxDiscount)
//   - Scope SPORTS
//   - validPlatforms ["android","ios"]  → App-only (hidden on web)
//   - condition FIRST_APP_BOOKING       → first app booking only
//   - maxUsesPerUser 1                  → once per customer
//   - isPublic true                     → shows on the app coupons page
//                                         (auto-hidden on web by platform)
//   - isActive FALSE                    → created DORMANT. Review the
//                                         discount value, then flip Active
//                                         in Admin → Coupons to go live.
//                                         While inactive it's fully dormant:
//                                         the app auto-attempt no-ops and it
//                                         doesn't show on the coupons page.
//
// CREATE-IF-ABSENT: if an APPFIRST coupon already exists it is left
// COMPLETELY untouched (admin edits preserved) — safe to re-run.
//
// Usage (production):
//   DATABASE_URL=$PRODUCTION_DB_URL npx tsx scripts/seed-app-first-booking-coupon.ts
// Or via .github/workflows/seed-app-first-booking-coupon.yml (workflow_dispatch).

import { db } from "../lib/db";

const CODE = "APPFIRST";
const VALUE_BPS = 2000; // 20%
const MAX_DISCOUNT_RUPEES = 150; // cap the percentage discount at ₹150
const FAR_FUTURE = new Date("2099-12-31T23:59:59Z");

async function main() {
  const existing = await db.coupon.findUnique({ where: { code: CODE } });
  if (existing) {
    console.log(
      `Coupon ${CODE} already exists (id=${existing.id}) — leaving it untouched.`,
    );
    return;
  }

  // createdBy needs the superadmin provisioned by prisma/seed.ts.
  const superadmin = await db.adminUser.findUnique({
    where: { username: "gamelord" },
    select: { id: true },
  });
  if (!superadmin) {
    throw new Error(
      "Expected superadmin `gamelord` to exist (provisioned by prisma/seed.ts). " +
        "Run the seed workflow first.",
    );
  }

  const created = await db.coupon.create({
    data: {
      code: CODE,
      description: "Welcome offer — 20% off your first booking on the app",
      scope: "SPORTS",
      type: "PERCENTAGE",
      value: VALUE_BPS,
      maxDiscount: MAX_DISCOUNT_RUPEES,
      maxUses: null, // unlimited total uses
      maxUsesPerUser: 1, // once per customer (also gated by FIRST_APP_BOOKING)
      minAmount: null,
      sportFilter: [],
      categoryFilter: [],
      categoryExclude: [],
      userGroupFilter: [],
      validPlatforms: ["android", "ios"], // App-only
      isStackable: false,
      stackGroup: null,
      isPublic: true,
      isSystemCode: false,
      validFrom: new Date(),
      validUntil: FAR_FUTURE,
      isActive: false, // DORMANT until admin reviews the value + activates
      createdBy: superadmin.id,
      conditions: {
        create: [{ conditionType: "FIRST_APP_BOOKING", conditionValue: "{}" }],
      },
    },
  });
  console.log(
    `Created coupon ${CODE} (id=${created.id}) — INACTIVE. ` +
      `Review the discount in Admin → Coupons, then toggle Active to go live.`,
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
