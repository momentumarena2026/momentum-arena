"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { DayType, TimeType } from "@prisma/client";
import { requireAdmin as requireAdminBase } from "@/lib/admin-auth";

async function requireAdmin() {
  const user = await requireAdminBase("MANAGE_PRICING");
  return user.id;
}

const pricingSchema = z.object({
  courtConfigId: z.string().min(1),
  dayType: z.enum(["WEEKDAY", "WEEKEND"]),
  timeType: z.enum(["PEAK", "OFF_PEAK"]),
  pricePerSlot: z.number().int().min(0),
});

export async function updatePricingRule(data: {
  courtConfigId: string;
  dayType: DayType;
  timeType: TimeType;
  pricePerSlot: number;
}) {
  await requireAdmin();

  const parsed = pricingSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: "Invalid pricing data" };
  }

  await db.pricingRule.upsert({
    where: {
      courtConfigId_dayType_timeType: {
        courtConfigId: parsed.data.courtConfigId,
        dayType: parsed.data.dayType,
        timeType: parsed.data.timeType,
      },
    },
    update: { pricePerSlot: parsed.data.pricePerSlot },
    create: parsed.data,
  });

  return { success: true };
}

export async function bulkUpdatePricing(
  updates: {
    courtConfigId: string;
    dayType: DayType;
    timeType: TimeType;
    pricePerSlot: number;
  }[]
) {
  await requireAdmin();

  const results = await Promise.all(
    updates.map((u) => updatePricingRule(u))
  );

  const failed = results.filter((r) => !r.success);
  if (failed.length > 0) {
    return {
      success: false,
      error: `${failed.length} updates failed`,
    };
  }
  return { success: true };
}

const timeClassSchema = z.object({
  startHour: z.number().int().min(5).max(24),
  endHour: z.number().int().min(6).max(25),
  dayType: z.enum(["WEEKDAY", "WEEKEND"]),
  timeType: z.enum(["PEAK", "OFF_PEAK"]),
});

export async function updateTimeClassification(data: {
  startHour: number;
  endHour: number;
  dayType: DayType;
  timeType: TimeType;
}) {
  await requireAdmin();

  const parsed = timeClassSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: "Invalid time classification data" };
  }

  if (parsed.data.endHour <= parsed.data.startHour) {
    return { success: false, error: "End hour must be after start hour" };
  }

  await db.timeClassification.upsert({
    where: {
      startHour_dayType: {
        startHour: parsed.data.startHour,
        dayType: parsed.data.dayType,
      },
    },
    update: {
      endHour: parsed.data.endHour,
      timeType: parsed.data.timeType,
    },
    create: parsed.data,
  });

  return { success: true };
}

export async function getAllPricingData() {
  await requireAdmin();

  const [configs, rules, classifications] = await Promise.all([
    db.courtConfig.findMany({ orderBy: [{ sport: "asc" }, { size: "asc" }] }),
    db.pricingRule.findMany(),
    db.timeClassification.findMany({ orderBy: { startHour: "asc" } }),
  ]);

  return { configs, rules, classifications };
}
