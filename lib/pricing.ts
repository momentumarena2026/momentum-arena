import { db } from "./db";
import { isWeekend, getAllSlotHours } from "./court-config";
import { DayType, TimeType } from "@prisma/client";

export interface SlotPrice {
  hour: number;
  price: number; // in rupees
  dayType: DayType;
  timeType: TimeType;
}

// Get price for each slot hour for a given config and date
export async function getSlotPricesForDate(
  courtConfigId: string,
  date: Date
): Promise<SlotPrice[]> {
  const dayType: DayType = isWeekend(date) ? "WEEKEND" : "WEEKDAY";

  const [classifications, pricingRules] = await Promise.all([
    db.timeClassification.findMany({
      where: { dayType },
      orderBy: { startHour: "asc" },
    }),
    db.pricingRule.findMany({
      where: { courtConfigId },
    }),
  ]);

  const hours = getAllSlotHours();
  return hours.map((hour) => {
    // Determine time type for this hour
    let timeType: TimeType = "OFF_PEAK";
    for (const c of classifications) {
      if (hour >= c.startHour && hour < c.endHour) {
        timeType = c.timeType;
        break;
      }
    }

    // Find matching price rule
    const rule = pricingRules.find(
      (r) => r.dayType === dayType && r.timeType === timeType
    );

    return {
      hour,
      price: rule?.pricePerSlot ?? 0,
      dayType,
      timeType,
    };
  });
}

// Calculate total price for selected slots
export function calculateTotal(
  slotPrices: SlotPrice[],
  selectedHours: number[]
): number {
  return slotPrices
    .filter((s) => selectedHours.includes(s.hour))
    .reduce((sum, s) => sum + s.price, 0);
}

// Format price in rupees to INR string
export function formatPrice(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

/**
 * Compact INR format for cramped UI tiles (e.g. dashboard stat cards).
 * Uses Indian denominations — K (thousand), L (lakh), Cr (crore) — and
 * drops trailing .0 so values stay short.
 *
 *   999        -> "₹999"
 *   1,250      -> "₹1.3K"
 *   36,650     -> "₹36.7K"
 *   1,25,000   -> "₹1.3L"
 *   1,50,00,000 -> "₹1.5Cr"
 */
export function formatPriceCompact(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  const trim = (n: number, digits = 1) =>
    n.toFixed(digits).replace(/\.0+$/, "");
  if (abs >= 10_000_000) return `${sign}₹${trim(abs / 10_000_000)}Cr`;
  if (abs >= 1_00_000) return `${sign}₹${trim(abs / 1_00_000)}L`;
  if (abs >= 1_000) return `${sign}₹${trim(abs / 1_000)}K`;
  return `${sign}₹${abs.toLocaleString("en-IN")}`;
}

/**
 * Format a booking date in IST timezone.
 * Booking dates are stored as @db.Date (UTC midnight), so we must
 * always specify Asia/Kolkata to avoid off-by-one on UTC servers.
 */
export function formatBookingDate(
  date: Date | string,
  opts?: Intl.DateTimeFormatOptions
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    ...opts,
  });
}
