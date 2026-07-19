"use server";

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { zonesOverlap } from "@/lib/court-config";
// Shared with the customer-facing sale path on purpose: the calendar
// has to render everything the booking engine considers sold, or the
// front desk sees a court as free that a customer can't book. Imported
// rather than re-declared so the two can't drift.
//
// It deliberately does NOT match the same-named list in
// actions/admin-booking.ts, which drops ABSENT. That one answers "may
// the counter re-SELL this hour?"; this one answers "is there a
// booking to DRAW in this cell?". A no-show is re-sellable but still
// has to show its pill, otherwise the resulting double-booked cell is
// unexplained. Do not align them.
import { OCCUPYING_BOOKING_STATUSES } from "@/lib/availability";
import type { CourtZone, Sport, ConfigSize } from "@prisma/client";

export interface CellBooking {
  id: string;
  // Includes the terminal closeouts: the front desk marking a session
  // COMPLETED or the customer ABSENT must not erase the booking from
  // the calendar, so those statuses reach the cell too.
  status: "CONFIRMED" | "PENDING" | "COMPLETED" | "ABSENT";
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
  // First entry of `bookings`. Redundant for every in-tree consumer
  // (they all read `bookings` now) but NOT removable: the shipped
  // TestFlight/store builds of AdminCalendarScreen only know about
  // `booking`, and they hit this same backend. Dropping it would
  // blank their calendar until they take an update. Remove once no
  // supported build reads it.
  booking?: CellBooking;
  // EVERY booking that occupies this cell. The bowling machine sells
  // 30-minute slots, so 14:00-14:30 and 14:30-15:00 are routinely two
  // different customers in the same hour cell; the half-court configs
  // can likewise put two distinct bookings under one overlapping
  // parent row. Collapsing to a single booking made the front desk
  // see a half-free hour and double-sell it.
  bookings?: CellBooking[];
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
      status: { in: [...OCCUPYING_BOOKING_STATUSES] },
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
  // 24-hour wall-clock grid.
  const hours: number[] = [];
  for (let h = 0; h < 24; h++) hours.push(h);

  // Map a display cell (hour on X's grid) to ALL canonical storage
  // coordinates a booking/block could be stored under for that
  // wall-clock moment.
  //
  // Hour 0 (12am-1am of X) has two valid storage forms in this
  // codebase:
  //   - Legacy customer-flow midnight booking on the venue's
  //     "session date":  (date = X-1, startHour = 24).
  //   - Admin create-booking flow (lib/admin-booking.ts ->
  //     getAvailableSlots iterates 0..23, stores against the
  //     actual calendar date):  (date = X, startHour = 0).
  //
  // Both represent the same wall-clock slot — we have to match
  // either so the admin's late-night bookings show up on the same
  // cell as the customer's midnight bookings.
  //
  // Hours 1..23 only have the natural-day storage form.
  const storageCoordsForHour = (
    hour: number,
  ): Array<{ storageDate: Date; storageHour: number }> => {
    if (hour === 0) {
      return [
        { storageDate: dateOnlyPrev, storageHour: 24 },
        { storageDate: dateOnly, storageHour: 0 },
      ];
    }
    return [{ storageDate: dateOnly, storageHour: hour }];
  };

  // Compare two dates by their UTC midnight ISO timestamp — booking.date
  // is stored as a @db.Date but Prisma hands it back as a Date object set
  // to that day's UTC midnight.
  const sameUtcDay = (a: Date, b: Date): boolean =>
    a.toISOString().split("T")[0] === b.toISOString().split("T")[0];

  // Helper: does a (date, hour) record match any of the storage
  // coords this display cell maps to? Used by both the block-match
  // and booking-match loops below.
  const matchesAnyCoord = (
    coords: Array<{ storageDate: Date; storageHour: number }>,
    recordDate: Date,
    recordHour: number | null,
  ): boolean =>
    coords.some(
      ({ storageDate, storageHour }) =>
        sameUtcDay(recordDate, storageDate) &&
        // Full-day blocks (startHour == null) match every hour on
        // their date — checked at the callsite by passing null and
        // letting the date comparison alone decide.
        (recordHour === null || recordHour === storageHour),
    );

  // Minute-of-hour at which a booking starts inside a given display
  // cell — the smallest startMinute among the slots that actually
  // land on that cell. Used only to order the cell's bookings.
  const cellStartMinute = (
    booking: (typeof bookings)[number],
    coords: Array<{ storageDate: Date; storageHour: number }>,
  ): number =>
    Math.min(
      ...booking.slots
        .filter((slot) =>
          matchesAnyCoord(coords, booking.date, slot.startHour),
        )
        .map((slot) => slot.startMinute),
    );

  // Build the grid: configId -> hour -> CellData
  const grid: Record<string, Record<number, CellData>> = {};

  for (const config of configs) {
    grid[config.id] = {};

    // Check slot blocks for this config
    for (const hour of hours) {
      const cellData: CellData = {};
      // Resolve the canonical storage coords this display cell could
      // map to. Most hours have one mapping; hour 0 has two (legacy
      // X-1/startHour 24 and new-convention X/startHour 0).
      const coords = storageCoordsForHour(hour);

      // Check if this hour is blocked
      const isBlocked = blocks.some((block) => {
        // matchesAnyCoord handles both the date and the hour
        // (passing null for full-day blocks).
        if (!matchesAnyCoord(coords, block.date, block.startHour))
          return false;

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
          if (!matchesAnyCoord(coords, block.date, block.startHour))
            return false;
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

      // Check bookings with zone overlap for this hour. A booking
      // contributes to this display cell if ANY of its slots
      // matches ANY of the cell's storage coords. The
      // .some-over-slots × .some-over-coords combination is small —
      // 1 or 2 coords, a handful of slots per booking.
      const matchingBookings = bookings.filter((booking) => {
        const slotMatch = booking.slots.some((slot) =>
          matchesAnyCoord(coords, booking.date, slot.startHour),
        );
        if (!slotMatch) return false;

        // Check zone overlap between booking's court config and this config
        return zonesOverlap(
          booking.courtConfig.zones as CourtZone[],
          config.zones as CourtZone[]
        );
      });

      // Order the cell's bookings by where they start inside the hour
      // so the half-hour pair reads 14:00-14:30 then 14:30-15:00, and
      // the legacy single `booking` field is the earlier of the two
      // instead of whatever order the DB happened to return.
      matchingBookings.sort(
        (a, b) => cellStartMinute(a, coords) - cellStartMinute(b, coords),
      );

      for (const matchingBooking of matchingBookings) {
        const cellBooking: CellBooking = {
          id: matchingBooking.id,
          status: matchingBooking.status as CellBooking["status"],
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
        (cellData.bookings ??= []).push(cellBooking);
        cellData.booking ??= cellBooking;
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
