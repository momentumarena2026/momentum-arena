import { CourtZone } from "@prisma/client";
import { db } from "./db";
import { getAllSlotHours, isWeekend } from "./court-config";
import { getTodayIST, getCurrentHourIST } from "./ist-date";

export type SlotStatus = "available" | "booked" | "locked" | "blocked";

export interface SlotAvailability {
  hour: number;
  status: SlotStatus;
  price: number; // in rupees
}

// Get availability for all slots on a given date for a specific court config
export async function getSlotAvailability(
  courtConfigId: string,
  date: Date
): Promise<SlotAvailability[]> {
  const config = await db.courtConfig.findUnique({
    where: { id: courtConfigId },
  });
  if (!config) throw new Error("Court config not found");

  const dateOnly = new Date(date.toISOString().split("T")[0]);
  const now = new Date();

  // 1. Bookings that reserve the slot: CONFIRMED (paid) or PENDING (awaiting admin verification)
  const conflictingBookings = await db.booking.findMany({
    where: {
      date: dateOnly,
      status: { in: ["CONFIRMED", "PENDING"] },
      courtConfig: {
        zones: { hasSome: config.zones as CourtZone[] },
      },
    },
    include: {
      courtConfig: true,
      slots: true,
    },
  });

  // Build set of occupied hours
  const occupiedHours = new Map<number, SlotStatus>();
  for (const booking of conflictingBookings) {
    for (const slot of booking.slots) {
      occupiedHours.set(
        slot.startHour,
        booking.status === "CONFIRMED" ? "booked" : "locked"
      );
    }
  }

  // 2. Transient SlotHolds — another user is currently in checkout for this slot
  const activeHolds = await db.slotHold.findMany({
    where: {
      date: dateOnly,
      expiresAt: { gt: now },
      courtConfig: {
        zones: { hasSome: config.zones as CourtZone[] },
      },
    },
  });
  for (const hold of activeHolds) {
    for (const hour of hold.hours) {
      // Holds shouldn't override "booked" (stricter) status
      if (!occupiedHours.has(hour)) {
        occupiedHours.set(hour, "locked");
      }
    }
  }

  // Check admin slot blocks
  const slotBlocks = await db.slotBlock.findMany({
    where: {
      date: dateOnly,
      OR: [
        { courtConfigId: courtConfigId },
        { sport: config.sport },
        { courtConfigId: null, sport: null }, // global blocks
      ],
    },
  });

  const blockedHours = new Set<number>();
  for (const block of slotBlocks) {
    if (block.startHour === null) {
      // Entire day blocked
      getAllSlotHours().forEach((h) => blockedHours.add(h));
    } else {
      blockedHours.add(block.startHour);
    }
  }

  // Also check if any overlapping configs have zone-level blocks
  // by checking blocks on configs that share zones
  const overlappingConfigBlocks = await db.slotBlock.findMany({
    where: {
      date: dateOnly,
      courtConfigId: { not: null },
      courtConfig: {
        zones: { hasSome: config.zones },
      },
    },
  });
  for (const block of overlappingConfigBlocks) {
    if (block.startHour === null) {
      getAllSlotHours().forEach((h) => blockedHours.add(h));
    } else {
      blockedHours.add(block.startHour);
    }
  }

  // Get pricing for this config
  const prices = await getSlotPrices(courtConfigId, date);

  // Check if the requested date is today (IST) — block past hours
  const todayIST = getTodayIST();
  const isToday = dateOnly.toISOString().split("T")[0] === todayIST;
  const currentHour = getCurrentHourIST();

  // Build availability array
  const hours = getAllSlotHours();
  return hours.map((hour) => {
    let status: SlotStatus = "available";

    // Block past hours on today's date
    if (isToday && hour <= currentHour) {
      status = "blocked";
    } else if (blockedHours.has(hour)) {
      status = "blocked";
    } else if (occupiedHours.has(hour)) {
      status = occupiedHours.get(hour)!;
    }

    return {
      hour,
      status,
      price: prices.get(hour) ?? 0,
    };
  });
}

// Get prices for each hour slot based on pricing rules and time classifications
async function getSlotPrices(
  courtConfigId: string,
  date: Date
): Promise<Map<number, number>> {
  const dayType = isWeekend(date) ? "WEEKEND" : "WEEKDAY";

  // Get time classifications for this day type
  const classifications = await db.timeClassification.findMany({
    where: { dayType },
    orderBy: { startHour: "asc" },
  });

  // Get pricing rules for this config
  const pricingRules = await db.pricingRule.findMany({
    where: { courtConfigId },
  });

  const priceMap = new Map<number, number>();
  const hours = getAllSlotHours();

  for (const hour of hours) {
    // Find which time type this hour falls into
    let timeType: "PEAK" | "OFF_PEAK" = "OFF_PEAK";
    for (const c of classifications) {
      if (hour >= c.startHour && hour < c.endHour) {
        timeType = c.timeType;
        break;
      }
    }

    // Find matching pricing rule
    const rule = pricingRules.find(
      (r) => r.dayType === dayType && r.timeType === timeType
    );
    priceMap.set(hour, rule?.pricePerSlot ?? 0);
  }

  return priceMap;
}

// Check if specific slots are available for a config (used during booking)
export async function checkSlotsAvailable(
  courtConfigId: string,
  date: Date,
  hours: number[]
): Promise<{ available: boolean; conflicts: number[] }> {
  const availability = await getSlotAvailability(courtConfigId, date);
  const conflicts: number[] = [];

  for (const hour of hours) {
    const slot = availability.find((s) => s.hour === hour);
    if (!slot || slot.status !== "available") {
      conflicts.push(hour);
    }
  }

  return { available: conflicts.length === 0, conflicts };
}
