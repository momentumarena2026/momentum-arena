import { PrismaClient } from "@prisma/client";
import { COURT_CONFIGS } from "../lib/court-config";

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
  const timeClassifications = [
    // Weekday: 5-16 off-peak, 16-25 peak
    { startHour: 5, endHour: 16, dayType: "WEEKDAY" as const, timeType: "OFF_PEAK" as const },
    { startHour: 16, endHour: 25, dayType: "WEEKDAY" as const, timeType: "PEAK" as const },
    // Weekend: all peak
    { startHour: 5, endHour: 25, dayType: "WEEKEND" as const, timeType: "PEAK" as const },
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

  // Seed default pricing rules (sample prices)
  const configs = await prisma.courtConfig.findMany();
  const defaultPrices: Record<string, Record<string, number>> = {
    // size -> "dayType_timeType" -> price in paise
    SMALL: {
      WEEKDAY_OFF_PEAK: 80000, // ₹800
      WEEKDAY_PEAK: 120000, // ₹1200
      WEEKEND_PEAK: 150000, // ₹1500
      WEEKEND_OFF_PEAK: 120000, // ₹1200
    },
    MEDIUM: {
      WEEKDAY_OFF_PEAK: 120000,
      WEEKDAY_PEAK: 180000,
      WEEKEND_PEAK: 220000,
      WEEKEND_OFF_PEAK: 180000,
    },
    LARGE: {
      WEEKDAY_OFF_PEAK: 180000,
      WEEKDAY_PEAK: 250000,
      WEEKEND_PEAK: 300000,
      WEEKEND_OFF_PEAK: 250000,
    },
    XL: {
      WEEKDAY_OFF_PEAK: 220000,
      WEEKDAY_PEAK: 300000,
      WEEKEND_PEAK: 380000,
      WEEKEND_OFF_PEAK: 300000,
    },
    FULL: {
      WEEKDAY_OFF_PEAK: 280000,
      WEEKDAY_PEAK: 400000,
      WEEKEND_PEAK: 500000,
      WEEKEND_OFF_PEAK: 400000,
    },
    SHARED: {
      WEEKDAY_OFF_PEAK: 40000, // ₹400
      WEEKDAY_PEAK: 60000, // ₹600
      WEEKEND_PEAK: 80000, // ₹800
      WEEKEND_OFF_PEAK: 60000, // ₹600
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

  // Seed new user system discount code
  await prisma.discountCode.upsert({
    where: { code: "NEWUSER" },
    update: {
      value: 1000, // 10%
      validUntil: new Date("2027-12-31"),
    },
    create: {
      code: "NEWUSER",
      type: "PERCENTAGE",
      value: 1000, // 10% (1000 basis points)
      maxUsesPerUser: 1,
      validFrom: new Date(),
      validUntil: new Date("2027-12-31"),
      isSystemCode: true,
      isActive: true,
      createdBy: "system",
    },
  });
  console.log("Seeded new user discount code");

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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
