import { CourtZone, DayType } from "@prisma/client";
import { db } from "./db";

/**
 * Half-hour-granular availability + pricing for the bowling-machine
 * court. Lives parallel to the hour-granular helpers in
 * `lib/availability.ts` rather than refactoring that file — every
 * existing cricket / football call site stays on the hour API, only
 * the bowling-machine surface uses this one.
 *
 * Slot key shape across the file:
 *   - `hour`   ∈ 0..24
 *   - `minute` ∈ 0 | 30
 *   - duration is always 30 minutes; the customer multi-selects
 *     consecutive 30-min entries to compose longer sessions.
 */

export type SlotStatus = "available" | "booked" | "locked" | "blocked" | "closed";

export interface BowlingSlot {
  hour: number;
  minute: number;
  status: SlotStatus;
  price: number; // rupees per 30-min slot
}

/**
 * Build the canonical list of 30-min slot keys for a single day,
 * driven by the `OperatingWindow` rows attached to the bowling court.
 * Empty list = closed that day-type (caller still gets a valid array
 * back so the UI can render a friendly "no slots today" message).
 */
async function buildSlotKeysForDate(
  courtConfigId: string,
  date: Date,
): Promise<Array<{ hour: number; minute: number }>> {
  // IST weekend check — same convention as `isWeekend` in court-config.ts.
  // The booking schema stores dates as @db.Date (UTC midnight), so a
  // direct getUTCDay() is correct for the calendar weekday.
  const day = date.getUTCDay();
  const isWeekend = day === 0 || day === 6;
  const dayType: DayType = isWeekend ? "WEEKEND" : "WEEKDAY";

  const windows = await db.operatingWindow.findMany({
    where: { courtConfigId, dayType },
    orderBy: [{ sortOrder: "asc" }, { startHour: "asc" }],
  });

  const slots: Array<{ hour: number; minute: number }> = [];
  for (const w of windows) {
    let h = w.startHour;
    let m = w.startMinute;
    while (h < w.endHour || (h === w.endHour && m < w.endMinute)) {
      slots.push({ hour: h, minute: m });
      // Advance by 30 minutes.
      if (m === 0) {
        m = 30;
      } else {
        m = 0;
        h += 1;
      }
    }
  }
  return slots;
}

/**
 * Returns one entry per 30-min slot for the bowling-machine court on
 * `date`, with availability + price. Slots outside any operating
 * window are simply not emitted (the UI doesn't need to render them
 * as greyed-out blocks; the time picker only shows real slots).
 */
export async function getBowlingMachineAvailability(
  courtConfigId: string,
  date: Date,
): Promise<BowlingSlot[]> {
  const config = await db.courtConfig.findUnique({
    where: { id: courtConfigId },
  });
  if (!config) throw new Error("Court config not found");

  const dateOnly = new Date(date.toISOString().split("T")[0]);
  const now = new Date();

  const allSlots = await buildSlotKeysForDate(courtConfigId, dateOnly);
  if (allSlots.length === 0) return [];

  // ── Bookings that occupy any slot via zone overlap ─────────────
  const conflictingBookings = await db.booking.findMany({
    where: {
      date: dateOnly,
      status: { in: ["CONFIRMED", "PENDING"] },
      courtConfig: {
        zones: { hasSome: config.zones as CourtZone[] },
      },
    },
    include: { slots: true },
  });

  // Map from "hour:minute" → status. Hour-granular bookings on the
  // overlapping half block BOTH 30-min slots of that hour (since the
  // physical pitch is taken for the full 60 minutes); half-hour
  // bookings (the bowling court itself) only block the matched slot.
  const occupied = new Map<string, SlotStatus>();
  function set(key: string, status: SlotStatus) {
    // "booked" beats "locked"; preserve stricter.
    const existing = occupied.get(key);
    if (existing === "booked") return;
    if (existing === "locked" && status === "locked") return;
    occupied.set(key, status);
  }
  function keyOf(h: number, m: number) {
    return `${h}:${m}`;
  }

  for (const booking of conflictingBookings) {
    const status = booking.status === "CONFIRMED" ? "booked" : "locked";
    for (const s of booking.slots) {
      if (s.durationMinutes === 30) {
        set(keyOf(s.startHour, s.startMinute), status);
      } else {
        // 60-min booking → blocks both halves of the hour
        set(keyOf(s.startHour, 0), status);
        set(keyOf(s.startHour, 30), status);
      }
    }
  }

  // ── In-flight slot holds ───────────────────────────────────────
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
    // hold.hours[i] paired with hold.startMinutes[i] (or 0 when the
    // parallel array is empty, i.e. a legacy 60-min hold).
    for (let i = 0; i < hold.hours.length; i++) {
      const h = hold.hours[i];
      const m = hold.startMinutes[i] ?? 0;
      // If startMinutes is empty, it's a 60-min hold blocking both halves.
      if (hold.startMinutes.length === 0) {
        set(keyOf(h, 0), "locked");
        set(keyOf(h, 30), "locked");
      } else {
        set(keyOf(h, m), "locked");
      }
    }
  }

  // ── Admin slot blocks ──────────────────────────────────────────
  const slotBlocks = await db.slotBlock.findMany({
    where: {
      date: dateOnly,
      OR: [
        { courtConfigId },
        { sport: config.sport },
        { courtConfigId: null, sport: null },
      ],
    },
  });
  const blockedKeys = new Set<string>();
  for (const block of slotBlocks) {
    if (block.startHour === null) {
      // Whole day blocked
      for (const s of allSlots) blockedKeys.add(keyOf(s.hour, s.minute));
    } else if (block.startMinute === 30) {
      blockedKeys.add(keyOf(block.startHour, 30));
    } else {
      // 0 = block whole hour (both halves)
      blockedKeys.add(keyOf(block.startHour, 0));
      blockedKeys.add(keyOf(block.startHour, 30));
    }
  }

  // ── Pricing — flat per-slot ₹ pulled from PricingRule ──────────
  // Bowling-machine PricingRule rows are seeded as ₹250 per slot
  // (same value across WEEKDAY/WEEKEND × PEAK/OFF_PEAK) so a single
  // findFirst is enough. Falls back to 250 if the row is missing.
  const dayType: DayType =
    [0, 6].includes(dateOnly.getUTCDay()) ? "WEEKEND" : "WEEKDAY";
  const priceRule = await db.pricingRule.findFirst({
    where: {
      courtConfigId,
      dayType,
    },
    orderBy: { pricePerSlot: "asc" }, // ties on weekday/weekend; pick off-peak by default
  });
  const slotPrice = priceRule?.pricePerSlot ?? 250;

  // Past-time guard for today only — same logic the hour grid uses.
  const today = new Date();
  const todayUtc = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  const isToday = dateOnly.getTime() === todayUtc.getTime();
  const nowHour = today.getHours();
  const nowMin = today.getMinutes();

  return allSlots.map(({ hour, minute }) => {
    const key = keyOf(hour, minute);
    let status: SlotStatus = "available";
    if (blockedKeys.has(key)) status = "blocked";
    else {
      const occ = occupied.get(key);
      if (occ) status = occ;
    }
    // Hide past slots on today
    if (isToday) {
      if (hour < nowHour || (hour === nowHour && minute <= nowMin)) {
        status = "closed";
      }
    }
    return { hour, minute, status, price: slotPrice };
  });
}
