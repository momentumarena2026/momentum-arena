"use server";

import { db } from "@/lib/db";
import { adminAuth } from "@/lib/admin-auth-session";

export interface RecurringTier {
  weeks: number;
  discountPercent: number;
}

export interface RecurringConfigData {
  id?: string;
  tiers: RecurringTier[];
  allowedDays: number[];
  maxWeeks: number;
  minWeeks: number;
  enabled: boolean;
}

export async function getRecurringConfig(): Promise<RecurringConfigData> {
  // Get or create singleton config
  let config = await db.recurringConfig.findFirst();

  if (!config) {
    config = await db.recurringConfig.create({
      data: {
        tiers: JSON.stringify([
          { weeks: 4, discountPercent: 5 },
          { weeks: 8, discountPercent: 10 },
          { weeks: 12, discountPercent: 15 },
        ]),
        allowedDays: JSON.stringify([0, 1, 2, 3, 4, 5, 6]),
        maxWeeks: 12,
        minWeeks: 2,
        enabled: true,
      },
    });
  }

  return {
    id: config.id,
    tiers: (typeof config.tiers === "string" ? JSON.parse(config.tiers) : config.tiers) as RecurringTier[],
    allowedDays: (typeof config.allowedDays === "string" ? JSON.parse(config.allowedDays) : config.allowedDays) as number[],
    maxWeeks: config.maxWeeks,
    minWeeks: config.minWeeks,
    enabled: config.enabled,
  };
}

export async function updateRecurringConfig(data: {
  tiers: RecurringTier[];
  allowedDays: number[];
  maxWeeks: number;
  minWeeks: number;
  enabled: boolean;
}): Promise<{ success: boolean; error?: string }> {
  const session = await adminAuth();
  if (!session?.user) {
    return { success: false, error: "Unauthorized" };
  }

  // Validate tiers
  const sortedTiers = [...data.tiers].sort((a, b) => a.weeks - b.weeks);
  for (const tier of sortedTiers) {
    if (tier.weeks < 1 || tier.weeks > 52) {
      return { success: false, error: "Week count must be between 1 and 52" };
    }
    if (tier.discountPercent < 0 || tier.discountPercent > 50) {
      return { success: false, error: "Discount must be between 0% and 50%" };
    }
  }

  if (data.minWeeks < 1) {
    return { success: false, error: "Minimum weeks must be at least 1" };
  }

  if (data.maxWeeks < data.minWeeks) {
    return { success: false, error: "Maximum weeks must be >= minimum weeks" };
  }

  // Get or create config
  const existing = await db.recurringConfig.findFirst();

  if (existing) {
    await db.recurringConfig.update({
      where: { id: existing.id },
      data: {
        tiers: JSON.stringify(sortedTiers),
        allowedDays: JSON.stringify(data.allowedDays),
        maxWeeks: data.maxWeeks,
        minWeeks: data.minWeeks,
        enabled: data.enabled,
      },
    });
  } else {
    await db.recurringConfig.create({
      data: {
        tiers: JSON.stringify(sortedTiers),
        allowedDays: JSON.stringify(data.allowedDays),
        maxWeeks: data.maxWeeks,
        minWeeks: data.minWeeks,
        enabled: data.enabled,
      },
    });
  }

  return { success: true };
}

// Public-facing action for customers to fetch recurring config
export async function getPublicRecurringConfig(): Promise<{
  enabled: boolean;
  tiers: RecurringTier[];
  allowedDays: number[];
  maxWeeks: number;
  minWeeks: number;
} | null> {
  const config = await db.recurringConfig.findFirst();
  if (!config || !config.enabled) return null;

  return {
    enabled: config.enabled,
    tiers: (typeof config.tiers === "string" ? JSON.parse(config.tiers) : config.tiers) as RecurringTier[],
    allowedDays: (typeof config.allowedDays === "string" ? JSON.parse(config.allowedDays) : config.allowedDays) as number[],
    maxWeeks: config.maxWeeks,
    minWeeks: config.minWeeks,
  };
}
