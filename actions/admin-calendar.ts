"use server";

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { zonesOverlap, OPERATING_HOURS } from "@/lib/court-config";
import type { CourtZone, Sport, ConfigSize } from "@prisma/client";

export interface CellBooking {
  id: string;
  status: "CONFIRMED" | "PENDING";
  userName: string;
  userEmail: string | null;
  userPhone: string | null;
  slots: number[];
  totalAmount: number;
  paymentStatus: string | null;
  paymentMethod: string | null;
}

export interface CellData {
  booking?: CellBooking;
  blocked?: boolean;
  blockReason?: string;
}

export interface CalendarConfig {
  id: string;
  sport: Sport;
  size: ConfigSize;
  label: string;
  position: string;
  zones: CourtZone[];
}

export interface CalendarData {
  configs: CalendarConfig[];
  grid: Record<string, Record<number, CellData>>;
  hours: number[];
}

export async function getCalendarData(
  date: string,
  sportFilter?: string
): Promise<CalendarData> {
  await requireAdmin("MANAGE_BOOKINGS");

  const dateOnly = new Date(date + "T00:00:00Z");

  // Fetch active court configs
  const configs = await db.courtConfig.findMany({
    where: {
      isActive: true,
      ...(sportFilter ? { sport: sportFilter as Sport } : {}),
    },
    orderBy: [{ sport: "asc" }, { size: "asc" }, { position: "asc" }],
  });

  // Fetch all active bookings for this date (CONFIRMED or PENDING)
  const bookings = await db.booking.findMany({
    where: {
      date: dateOnly,
      status: { in: ["CONFIRMED", "PENDING"] },
    },
    include: {
      user: { select: { name: true, email: true, phone: true } },
      courtConfig: true,
      slots: { orderBy: { startHour: "asc" } },
      payment: { select: { status: true, method: true } },
    },
  });

  // Fetch all slot blocks for this date
  const blocks = await db.slotBlock.findMany({
    where: { date: dateOnly },
    include: { courtConfig: true },
  });

  // Build hours array
  const hours: number[] = [];
  for (let h = OPERATING_HOURS.start; h < OPERATING_HOURS.end; h++) {
    hours.push(h);
  }

  // Build the grid: configId -> hour -> CellData
  const grid: Record<string, Record<number, CellData>> = {};

  for (const config of configs) {
    grid[config.id] = {};

    // Check slot blocks for this config
    for (const hour of hours) {
      const cellData: CellData = {};

      // Check if this hour is blocked
      const isBlocked = blocks.some((block) => {
        // Full-day block (startHour is null)
        const matchesHour = block.startHour === null || block.startHour === hour;
        if (!matchesHour) return false;

        // Block applies to this specific config
        if (block.courtConfigId === config.id) return true;

        // Block applies to this sport
        if (block.sport === config.sport && !block.courtConfigId) return true;

        // Block applies to all courts (no config, no sport)
        if (!block.courtConfigId && !block.sport) return true;

        // Check zone overlap for config-specific blocks
        if (block.courtConfig && block.courtConfigId !== config.id) {
          return zonesOverlap(
            block.courtConfig.zones as CourtZone[],
            config.zones as CourtZone[]
          );
        }

        return false;
      });

      if (isBlocked) {
        const matchingBlock = blocks.find((block) => {
          const matchesHour =
            block.startHour === null || block.startHour === hour;
          if (!matchesHour) return false;
          if (block.courtConfigId === config.id) return true;
          if (block.sport === config.sport && !block.courtConfigId) return true;
          if (!block.courtConfigId && !block.sport) return true;
          if (block.courtConfig && block.courtConfigId !== config.id) {
            return zonesOverlap(
              block.courtConfig.zones as CourtZone[],
              config.zones as CourtZone[]
            );
          }
          return false;
        });
        cellData.blocked = true;
        cellData.blockReason = matchingBlock?.reason || undefined;
      }

      // Check bookings with zone overlap for this hour
      const matchingBooking = bookings.find((booking) => {
        // Check if this booking occupies this hour
        const hasHour = booking.slots.some((s) => s.startHour === hour);
        if (!hasHour) return false;

        // Check zone overlap between booking's court config and this config
        return zonesOverlap(
          booking.courtConfig.zones as CourtZone[],
          config.zones as CourtZone[]
        );
      });

      if (matchingBooking) {
        cellData.booking = {
          id: matchingBooking.id,
          status: matchingBooking.status as "CONFIRMED" | "PENDING",
          userName:
            matchingBooking.user.name ||
            matchingBooking.user.email ||
            matchingBooking.user.phone ||
            "Unknown",
          userEmail: matchingBooking.user.email,
          userPhone: matchingBooking.user.phone,
          slots: matchingBooking.slots.map((s) => s.startHour),
          totalAmount: matchingBooking.totalAmount,
          paymentStatus: matchingBooking.payment?.status || null,
          paymentMethod: matchingBooking.payment?.method || null,
        };
      }

      // Only add cell data if there's something to show
      if (cellData.booking || cellData.blocked) {
        grid[config.id][hour] = cellData;
      }
    }
  }

  return {
    configs: configs.map((c) => ({
      id: c.id,
      sport: c.sport,
      size: c.size,
      label: c.label,
      position: c.position,
      zones: c.zones as CourtZone[],
    })),
    grid,
    hours,
  };
}
