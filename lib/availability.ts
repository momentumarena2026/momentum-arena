import { CourtZone, Sport } from "@prisma/client";
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

  // Check if the requested date is today or in the past (IST)
  const todayIST = getTodayIST();
  const dateStr = dateOnly.toISOString().split("T")[0];
  const isToday = dateStr === todayIST;
  const isPastDate = dateStr < todayIST;
  const currentHour = getCurrentHourIST();

  // Build availability array
  const hours = getAllSlotHours();
  return hours.map((hour) => {
    let status: SlotStatus = "available";

    // Block all hours on past dates, and past hours on today's date.
    if (isPastDate || (isToday && hour <= currentHour)) {
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

// ---------------------------------------------------------------------------
// Half-court ("Medium") unified availability
// ---------------------------------------------------------------------------
// Customers book a single "Half Court (40×90)" tile that represents *either*
// the LEFT or RIGHT MEDIUM config. The underlying LEFT/RIGHT configs share no
// zones, so two different customers can book the same hour simultaneously —
// the venue assigns physical sides at game time. An hour is available to the
// customer as long as at least one half is free. Pricing is identical between
// LEFT and RIGHT by business rule; we expose LEFT's price as canonical.

export interface MediumConfigsPair {
  leftId: string;
  rightId: string;
}

/**
 * Look up the LEFT + RIGHT MEDIUM courtConfig ids for a sport. Throws if
 * either side is missing (currently only CRICKET has MEDIUM configs).
 */
export async function getMediumConfigs(
  sport: Sport
): Promise<MediumConfigsPair> {
  const configs = await db.courtConfig.findMany({
    where: { sport, size: "MEDIUM", isActive: true },
    select: { id: true, position: true },
  });
  const left = configs.find((c) => c.position === "LEFT");
  const right = configs.find((c) => c.position === "RIGHT");
  if (!left || !right) {
    throw new Error(`Half-court configs not found for sport ${sport}`);
  }
  return { leftId: left.id, rightId: right.id };
}

/**
 * Per-hour merged availability across LEFT + RIGHT halves.
 * - available: at least one half is available
 * - booked:    both halves occupied by a CONFIRMED booking/hold
 * - locked:    at least one half locked, the other not strictly free
 * - blocked:   both halves blocked (admin block, or past hour)
 * Price is taken from LEFT's pricing table (LEFT == RIGHT by business rule).
 */
export async function getMergedMediumAvailability(
  sport: Sport,
  date: Date
): Promise<SlotAvailability[]> {
  const { leftId, rightId } = await getMediumConfigs(sport);

  const [left, right] = await Promise.all([
    getSlotAvailability(leftId, date),
    getSlotAvailability(rightId, date),
  ]);

  // Severity ordering: available < locked < booked/blocked.
  // Hour is "available" if at least one side is available. Otherwise pick the
  // least-severe of the two sides so the customer sees the clearest signal.
  const severity: Record<SlotStatus, number> = {
    available: 0,
    locked: 1,
    booked: 2,
    blocked: 2,
  };

  const leftByHour = new Map(left.map((s) => [s.hour, s]));
  return right.map((r) => {
    const l = leftByHour.get(r.hour)!;
    let status: SlotStatus;
    if (l.status === "available" || r.status === "available") {
      status = "available";
    } else {
      status = severity[l.status] <= severity[r.status] ? l.status : r.status;
    }
    return {
      hour: r.hour,
      status,
      // Prices are equal between halves; fall back to right in case left is 0.
      price: l.price || r.price,
    };
  });
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
