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

  // Refuse to upsert a row whose hour range overlaps another classification
  // on the same dayType — pricing lookup picks the first match by
  // startHour ASC, so overlaps silently mask each other and an edit
  // here would surprise the venue admin.
  const overlapping = await db.timeClassification.findFirst({
    where: {
      dayType: parsed.data.dayType,
      // Exclude the row we'd be overwriting on this exact startHour
      // (that's an update, not a conflict).
      NOT: { startHour: parsed.data.startHour },
      AND: [
        { startHour: { lt: parsed.data.endHour } },
        { endHour: { gt: parsed.data.startHour } },
      ],
    },
    select: { startHour: true, endHour: true, timeType: true },
  });
  if (overlapping) {
    return {
      success: false,
      error: `Range ${parsed.data.startHour}–${parsed.data.endHour} overlaps an existing ${parsed.data.dayType} band (${overlapping.startHour}–${overlapping.endHour} ${overlapping.timeType}). Delete that row first or adjust the hours.`,
    };
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

  const { revalidatePath } = await import("next/cache");
  revalidatePath("/admin/pricing");
  return { success: true };
}

/**
 * Drop a TimeClassification row. Hours falling outside any
 * classification still book successfully but resolve to the
 * OFF_PEAK price by default (see lib/pricing.ts) — so deletion
 * is "wider off-peak band" rather than "those hours can't be
 * priced anymore."
 */
export async function deleteTimeClassification(id: string) {
  await requireAdmin();
  if (!id) return { success: false, error: "Missing id" };
  try {
    await db.timeClassification.delete({ where: { id } });
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete",
    };
  }
  const { revalidatePath } = await import("next/cache");
  revalidatePath("/admin/pricing");
  return { success: true };
}

export async function getAllPricingData() {
  await requireAdmin();

  const [configs, rules, classifications] = await Promise.all([
    db.courtConfig.findMany({ where: { isActive: true }, orderBy: [{ sport: "asc" }, { size: "asc" }] }),
    db.pricingRule.findMany(),
    db.timeClassification.findMany({ orderBy: { startHour: "asc" } }),
  ]);

  return { configs, rules, classifications };
}
