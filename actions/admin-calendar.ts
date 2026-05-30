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
  // `slots` is the legacy hour-only projection — kept for back-
  // compat with consumers that just need "which hour cells does this
  // booking appear in". Half-hour bookings (bowling machine) still
  // expose their hour here so the cell match-up below works as-is.
  slots: number[];
  // Rich slot info so the calendar can tell a 4:00-5:00 booking from
  // a 4:30-5:00 one inside the same hour cell. The visual indicator
  // strip + sub-hour time line on the booking pill both read from
  // here. For ordinary cricket/football slots this is just the
  // hourly default ({startMinute:0, durationMinutes:60}).
  slotDetails: Array<{
    startHour: number;
    startMinute: number;
    durationMinutes: number;
  }>;
  totalAmount: number;
  paymentStatus: string | null;
  paymentMethod: string | null;
  // The booking's actual owning court — NOT the iterated config the
  // cell happens to live under. The grid duplicates a booking into
  // every config whose zones overlap with the booking's court (so a
  // Cricket Full Field booking shows up under Medium (Left Half) and
  // Medium (Right Half) too). Clients that pivot the grid by hour
  // need to know the real owner to render the right court label and
  // sport chip; without it they'd pick whichever overlapping config
  // they iterated first.
  courtLabel: string;
  courtSport: Sport;
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
  sportFilter?: string,
  // Mobile admin routes authenticate via JWT before calling this
  // server action. Pass true to skip the NextAuth cookie check that
  // `requireAdmin` performs. Web call sites omit the flag.
  skipAuth?: boolean,
): Promise<CalendarData> {
  if (!skipAuth) {
    await requireAdmin("MANAGE_BOOKINGS");
  }

  const dateOnly = new Date(date + "T00:00:00Z");
  // Prior calendar date. Bookings stored as `(date = X-1,
  // startHour = 24)` are wall-clock 12am of X, so they live in the
  // hour-0 column of the X grid. Fetching both dates in one
  // query keeps that lookup cheap.
  const dateOnlyPrev = new Date(dateOnly);
  dateOnlyPrev.setUTCDate(dateOnlyPrev.getUTCDate() - 1);

  // Fetch active court configs
  const configs = await db.courtConfig.findMany({
    where: {
      isActive: true,
      ...(sportFilter ? { sport: sportFilter as Sport } : {}),
    },
    orderBy: [{ sport: "asc" }, { size: "asc" }, { position: "asc" }],
  });

  // Active bookings for this date AND the prior date. We need the
  // prior date so any (startHour = 24) slot stored against it — i.e.
  // the "12am-1am of X" session — surfaces in hour 0 of X's grid.
  const bookings = await db.booking.findMany({
    where: {
      date: { in: [dateOnly, dateOnlyPrev] },
      status: { in: ["CONFIRMED", "PENDING"] },
    },
    include: {
      user: { select: { name: true, email: true, phone: true } },
      courtConfig: true,
      slots: { orderBy: { startHour: "asc" } },
      payment: { select: { status: true, method: true } },
    },
  });

  // Slot blocks for this date AND the prior date (same hour-24 →
  // hour-0 reasoning applies — admin blocks at midnight of X are
  // stored on X-1's startHour=24).
  const blocks = await db.slotBlock.findMany({
    where: { date: { in: [dateOnly, dateOnlyPrev] } },
    include: { courtConfig: true },
  });

  // Build hours array — admin calendar always renders the full
  // 24-hour wall-clock grid. Hour 0 displays the X-1 hour-24
  // bookings; hours 1–23 display X's hour-1..23 bookings; X's
  // own hour-24 entries belong on X+1's grid (handled there).
  const hours: number[] = [];
  for (let h = 0; h < 24; h++) hours.push(h);

  // Map a display cell (hour on X's grid) to the canonical storage
  // coordinates used by Booking.date + BookingSlot.startHour.
  const storageCoordsForHour = (
    hour: number,
  ): { storageDate: Date; storageHour: number } => {
    if (hour === 0)
      return { storageDate: dateOnlyPrev, storageHour: 24 };
    return { storageDate: dateOnly, storageHour: hour };
  };

  // Compare two dates by their UTC midnight ISO timestamp — booking.date
  // is stored as a @db.Date but Prisma hands it back as a Date object set
  // to that day's UTC midnight.
  const sameUtcDay = (a: Date, b: Date): boolean =>
    a.toISOString().split("T")[0] === b.toISOString().split("T")[0];

  // Build the grid: configId -> hour -> CellData
  const grid: Record<string, Record<number, CellData>> = {};

  for (const config of configs) {
    grid[config.id] = {};

    // Check slot blocks for this config
    for (const hour of hours) {
      const cellData: CellData = {};
      // Resolve the canonical storage coordinates this display cell
      // maps to. Hour 0 of date X = (date X-1, slot startHour 24).
      // Every match below compares against these, not `hour` directly.
      const { storageDate, storageHour } = storageCoordsForHour(hour);

      // Check if this hour is blocked
      const isBlocked = blocks.some((block) => {
        if (!sameUtcDay(block.date, storageDate)) return false;
        // Full-day blocks (startHour is null) on the storage date hit
        // every display cell that maps back to that date — for the
        // hour-0 case that's only the cell sourced from X-1, not X's
        // mid-day cells.
        const matchesHour =
          block.startHour === null || block.startHour === storageHour;
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
          if (!sameUtcDay(block.date, storageDate)) return false;
          const matchesHour =
            block.startHour === null || block.startHour === storageHour;
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
        // Booking must live on the storage date this cell maps to —
        // either X (hours 1–23) or X-1 (hour 0 / startHour 24).
        if (!sameUtcDay(booking.date, storageDate)) return false;
        const hasHour = booking.slots.some(
          (s) => s.startHour === storageHour,
        );
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
          slotDetails: matchingBooking.slots.map((s) => ({
            startHour: s.startHour,
            startMinute: s.startMinute,
            durationMinutes: s.durationMinutes,
          })),
          totalAmount: matchingBooking.totalAmount,
          paymentStatus: matchingBooking.payment?.status || null,
          paymentMethod: matchingBooking.payment?.method || null,
          // Always the booking's OWN court, not the iterated config
          // we're populating. Lets the grid-pivot clients (mobile +
          // web new layout) render the correct sport chip + court
          // label even when the same booking appears under multiple
          // overlapping configs.
          courtLabel: matchingBooking.courtConfig.label,
          courtSport: matchingBooking.courtConfig.sport,
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
