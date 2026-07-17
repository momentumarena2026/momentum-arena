import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/password";
import { ALL_PERMISSIONS } from "../lib/permissions";

const prisma = new PrismaClient();

/**
 * Production seed — runs on every push to `main` via the seed-production
 * workflow, and on every push to `development` via seed-staging.
 *
 * The only thing this script does is upsert the "gamelord" superadmin so
 * there's always a login that can reach /admin. The update branch refreshes
 * `permissions` to the current `ALL_PERMISSIONS` export, so newly-added
 * permission constants are auto-granted to the superadmin without a manual
 * intervention each release.
 *
 * Everything else (court configs, time classifications, pricing rules,
 * coupons, FAQs, court-deactivations, NEWUSER state) used to live here as
 * `upsert(..., update: { … })` blocks. The update branches silently
 * clobbered admin edits on every deploy — most visibly, bowling-machine
 * pricing kept resetting from ₹250 back to the hardcoded SHARED defaults
 * (₹400/₹600) until we pulled those blocks out. All of that data is now
 * admin-managed via the /admin/* surfaces and bootstrapped manually on a
 * fresh DB (or restored from a snapshot).
 */
async function main() {
  const superadminPassword = await hashPassword("burninhell@26");
  await prisma.adminUser.upsert({
    where: { username: "gamelord" },
    update: {
      permissions: [...ALL_PERMISSIONS],
    },
    create: {
      username: "gamelord",
      email: "y12.nakul@gmail.com",
      passwordHash: superadminPassword,
      role: "SUPERADMIN",
      permissions: [...ALL_PERMISSIONS],
      isDeletable: false,
    },
  });
  console.log("Seeded superadmin user: gamelord");

  // ── WORLDCUP25 — worldcup-final-day football promo ────────────────
  // 25% off FOOTBALL bookings whose PLAY DATE is 20 Jul 2026 (the
  // final), auto-applied at checkout AHEAD of the new-user welcome
  // code (autoApply coupons are tried first by both checkouts).
  //
  // CREATE-ONLY upsert (update: {}) per this file's policy — the seed
  // creates the coupon once per environment (dev now; production when
  // the branch is promoted to main, via seed-production) and never
  // clobbers later admin edits. Admins retire it via isActive.
  const gamelord = await prisma.adminUser.findUnique({
    where: { username: "gamelord" },
    select: { id: true },
  });
  await prisma.coupon.upsert({
    where: { code: "WORLDCUP25" },
    update: {},
    create: {
      code: "WORLDCUP25",
      description:
        "Worldcup Final Day — 25% off football bookings played on 20 Jul 2026",
      scope: "SPORTS",
      type: "PERCENTAGE",
      value: 2500, // basis points = 25%
      maxUses: null, // unlimited total
      maxUsesPerUser: 1_000_000, // effectively unlimited (schema min 1)
      minAmount: null, // no minimum
      sportFilter: ["FOOTBALL"],
      validPlatforms: [], // web + app
      isStackable: false,
      isPublic: true,
      isSystemCode: false,
      autoApply: true,
      // Redeemable from now until the end of final day IST — the
      // BOOKING_DATE condition below is what pins WHICH day is booked.
      validFrom: new Date("2026-07-16T00:00:00+05:30"),
      validUntil: new Date("2026-07-20T23:59:59+05:30"),
      isActive: true,
      createdBy: gamelord!.id,
      conditions: {
        create: [
          {
            conditionType: "BOOKING_DATE",
            conditionValue: JSON.stringify({
              from: "2026-07-20",
              to: "2026-07-20",
            }),
          },
        ],
      },
    },
  });
  console.log("Seeded coupon: WORLDCUP25 (create-only)");

  // ── Pickleball launch banner → promo-banner system ────────────────
  // Migrates the previously-hardcoded homepage + slot-page banner into
  // the admin-managed PromoBanner module. Linked to PICKLEBALL25 so it
  // keeps the exact old behaviour: visible while the coupon is live,
  // gone the moment admin disables/expires it. CREATE-ONLY (find by
  // title) — admin edits are never clobbered.
  const pickleball25 = await prisma.coupon.findUnique({
    where: { code: "PICKLEBALL25" },
    select: { id: true },
  });
  const existingPbBanner = await prisma.promoBanner.findFirst({
    where: { title: "Pickleball Launch Offer" },
    select: { id: true },
  });
  if (!existingPbBanner) {
    await prisma.promoBanner.create({
      data: {
        title: "Pickleball Launch Offer",
        // Site-relative /public asset (1200×400) — web renders it
        // directly; the mobile API absolutises it per request.
        imageUrl: "/pickleball-promo-banner.jpg",
        appImageUrl: "/pickleball-promo-banner.jpg",
        aspectRatio: 3,
        linkUrl: "/book/pickleball",
        placement: ["HOME_PROMO", "SLOT_SELECTION"],
        couponId: pickleball25?.id ?? null,
        startsAt: null,
        endsAt: null,
        isActive: true,
        sortOrder: 0,
        createdBy: gamelord!.id,
      },
    });
    console.log("Seeded promo banner: Pickleball Launch Offer (create-only)");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
