import { PrismaClient } from "@prisma/client";
import { COURT_CONFIGS } from "../lib/court-config";
import { hashPassword } from "../lib/password";
import { ALL_PERMISSIONS } from "../lib/permissions";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding court configurations...");

  // Upsert all court configs
  for (const config of COURT_CONFIGS) {
    await prisma.courtConfig.upsert({
      where: {
        sport_size_position: {
          sport: config.sport,
          size: config.size,
          position: config.position,
        },
      },
      update: {
        label: config.label,
        widthFt: config.widthFt,
        lengthFt: config.lengthFt,
        zones: config.zones,
      },
      create: {
        sport: config.sport,
        size: config.size,
        label: config.label,
        position: config.position,
        widthFt: config.widthFt,
        lengthFt: config.lengthFt,
        zones: config.zones,
      },
    });
  }
  console.log(`Seeded ${COURT_CONFIGS.length} court configurations`);

  // Seed default time classifications
  // Day time: 5am-5pm (OFF_PEAK), Night time: 5pm-12am (PEAK)
  const timeClassifications = [
    // Weekday: 5-17 day (off-peak), 17-25 night (peak)
    { startHour: 5, endHour: 17, dayType: "WEEKDAY" as const, timeType: "OFF_PEAK" as const },
    { startHour: 17, endHour: 25, dayType: "WEEKDAY" as const, timeType: "PEAK" as const },
    // Weekend: same split
    { startHour: 5, endHour: 17, dayType: "WEEKEND" as const, timeType: "OFF_PEAK" as const },
    { startHour: 17, endHour: 25, dayType: "WEEKEND" as const, timeType: "PEAK" as const },
  ];

  for (const tc of timeClassifications) {
    await prisma.timeClassification.upsert({
      where: {
        startHour_dayType: {
          startHour: tc.startHour,
          dayType: tc.dayType,
        },
      },
      update: {
        endHour: tc.endHour,
        timeType: tc.timeType,
      },
      create: tc,
    });
  }
  console.log("Seeded time classifications");

  // Deactivate removed/unavailable court configs:
  // - SMALL cricket (legacy)
  // - XL cricket (no longer offered)
  // - Football MEDIUM/LARGE/XL (only FULL field offered)
  // - XS cricket leather pitches (bowling machine unavailable)
  // - PICKLEBALL (coming soon)
  await prisma.courtConfig.updateMany({
    where: { sport: "CRICKET", size: { in: ["SMALL", "XL", "XS"] }, isActive: true },
    data: { isActive: false },
  });
  await prisma.courtConfig.updateMany({
    where: { sport: "FOOTBALL", size: { in: ["SMALL", "MEDIUM", "LARGE", "XL"] }, isActive: true },
    data: { isActive: false },
  });
  await prisma.courtConfig.updateMany({
    where: { sport: { in: ["PICKLEBALL"] }, isActive: true },
    data: { isActive: false },
  });
  console.log("Deactivated unavailable / coming-soon court configs");

  // Seed default pricing rules
  // Day time (OFF_PEAK): 5am-5pm | Night time (PEAK): 5pm-12am
  // Same prices for weekday and weekend
  const configs = await prisma.courtConfig.findMany();
  const defaultPrices: Record<string, Record<string, number>> = {
    // size -> "dayType_timeType" -> price in rupees
    XS: {
      WEEKDAY_OFF_PEAK: 500,
      WEEKDAY_PEAK: 800,
      WEEKEND_OFF_PEAK: 500,
      WEEKEND_PEAK: 800,
    },
    // 40x90: Day ₹1000, Night ₹1200
    MEDIUM: {
      WEEKDAY_OFF_PEAK: 1000,
      WEEKDAY_PEAK: 1200,
      WEEKEND_OFF_PEAK: 1000,
      WEEKEND_PEAK: 1200,
    },
    // 60x90: Day ₹1300, Night ₹1500
    LARGE: {
      WEEKDAY_OFF_PEAK: 1300,
      WEEKDAY_PEAK: 1500,
      WEEKEND_OFF_PEAK: 1300,
      WEEKEND_PEAK: 1500,
    },
    // 80x90 (Full Field — Cricket & Football): Day ₹1600, Night ₹2000
    FULL: {
      WEEKDAY_OFF_PEAK: 1600,
      WEEKDAY_PEAK: 2000,
      WEEKEND_OFF_PEAK: 1600,
      WEEKEND_PEAK: 2000,
    },
    SHARED: {
      WEEKDAY_OFF_PEAK: 400,
      WEEKDAY_PEAK: 600,
      WEEKEND_OFF_PEAK: 400,
      WEEKEND_PEAK: 600,
    },
  };

  for (const config of configs) {
    const prices = defaultPrices[config.size];
    if (!prices) continue;

    for (const [key, price] of Object.entries(prices)) {
      const parts = key.split("_");
      const dayType = parts[0] as "WEEKDAY" | "WEEKEND";
      const timeType = parts.slice(1).join("_") as "PEAK" | "OFF_PEAK";
      await prisma.pricingRule.upsert({
        where: {
          courtConfigId_dayType_timeType: {
            courtConfigId: config.id,
            dayType,
            timeType,
          },
        },
        update: { pricePerSlot: price },
        create: {
          courtConfigId: config.id,
          dayType,
          timeType,
          pricePerSlot: price,
        },
      });
    }
  }
  console.log("Seeded default pricing rules");

  // Legacy 10% new-user discount — superseded by the first-time FLAT100
  // coupon seeded below. Keep the row for audit history but mark inactive so
  // getNewUserDiscount returns null and the checkout falls through to FLAT100.
  await prisma.discountCode.upsert({
    where: { code: "NEWUSER" },
    update: {
      isActive: false,
    },
    create: {
      code: "NEWUSER",
      type: "PERCENTAGE",
      value: 1000, // 10% (1000 basis points)
      maxUsesPerUser: 1,
      validFrom: new Date(),
      validUntil: new Date("2027-12-31"),
      isSystemCode: true,
      isActive: false,
      createdBy: "system",
    },
  });
  console.log("Deactivated legacy NEWUSER 10% discount");

  // Seed default FAQ entries
  const { FAQ_ENTRIES } = await import("../lib/faq-data");
  for (const faq of FAQ_ENTRIES) {
    const existing = await prisma.fAQEntry.findFirst({
      where: { question: faq.question },
    });
    if (!existing) {
      await prisma.fAQEntry.create({
        data: {
          question: faq.question,
          answer: faq.answer,
          keywords: faq.keywords,
          category: faq.category,
        },
      });
    }
  }
  console.log(`Seeded ${FAQ_ENTRIES.length} FAQ entries`);

  // Seed FLAT100 coupon — welcome offer: flat Rs.100 OFF for a user's very
  // first booking. Enforced by:
  //   - userGroupFilter [FIRST_TIME]     → 0 prior confirmed bookings AND
  //                                        0 prior completed cafe orders
  //   - maxUsesPerUser = 1 (schema default) → at most one redemption per user
  //   - isSystemCode = true             → auto-applied at checkout
  await prisma.coupon.upsert({
    where: { code: "FLAT100" },
    update: {
      value: 100,
      description: "Welcome offer: Flat Rs.100 OFF your first booking",
      userGroupFilter: ["FIRST_TIME"],
      minAmount: null,
      maxUsesPerUser: 1,
      isActive: true,
    },
    create: {
      code: "FLAT100",
      description: "Welcome offer: Flat Rs.100 OFF your first booking",
      type: "FLAT",
      value: 100,
      scope: "SPORTS",
      userGroupFilter: ["FIRST_TIME"],
      maxUsesPerUser: 1,
      isPublic: true,
      isSystemCode: true,
      validFrom: new Date(),
      validUntil: new Date("2027-12-31"),
      isActive: true,
      createdBy: "system",
    },
  });
  console.log("Seeded FLAT100 first-time-user coupon");

  // Seed superadmin user "gamelord"
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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
