import { db } from "./db";
import { isWeekend, getAllSlotHours } from "./court-config";
import { DayType, TimeType } from "@prisma/client";

export interface SlotPrice {
  hour: number;
  price: number; // in paise
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

// Format price from paise to INR string
export function formatPrice(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
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
