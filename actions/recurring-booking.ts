"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { checkSlotsAvailable } from "@/lib/availability";
import { getSlotPricesForDate, formatBookingDate } from "@/lib/pricing";

const MAX_WEEKS_AHEAD = 4; // Initial bookings created upfront
const MAX_TOTAL_MONTHS = 3; // Maximum recurrence window
const MAX_DAYS_AHEAD = 14; // Initial daily bookings created upfront

export interface RecurringBookingResult {
  success: boolean;
  error?: string;
  recurringBookingId?: string;
  bookingsCreated?: number;
}

export async function createRecurringBooking(data: {
  courtConfigId: string;
  startHour: number;
  endHour: number;
  dayOfWeek: number; // 0=Sunday ... 6=Saturday
  startDate: string; // ISO date string
  mode?: "weekly" | "daily";
  weeksCount?: number; // Total weeks (null = indefinite, capped at MAX_TOTAL_MONTHS * 4)
  daysCount?: number; // Total consecutive days for daily mode
}): Promise<RecurringBookingResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  const { courtConfigId, startHour, endHour, dayOfWeek, startDate, mode = "weekly", weeksCount, daysCount } = data;

  if (startHour >= endHour) {
    return { success: false, error: "Invalid time range" };
  }

  if (dayOfWeek < 0 || dayOfWeek > 6) {
    return { success: false, error: "Invalid day of week" };
  }

  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);

  // Verify start date is in the future
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (start < today) {
    return { success: false, error: "Start date must be in the future" };
  }

  // Generate hours array for the slots
  const hours: number[] = [];
  for (let h = startHour; h < endHour; h++) {
    hours.push(h);
  }

  if (mode === "daily") {
    return createDailyRecurringBooking({
      userId: session.user.id!,
      courtConfigId,
      startHour,
      endHour,
      dayOfWeek,
      start,
      hours,
      daysCount: daysCount || 3,
    });
  }

  // Weekly mode
  // Verify the start date matches the day of week
  if (start.getDay() !== dayOfWeek) {
    return {
      success: false,
      error: "Start date does not match the selected day of week",
    };
  }

  // Calculate end date
  let endDate: Date | null = null;
  const totalWeeks = weeksCount
    ? Math.min(weeksCount, MAX_TOTAL_MONTHS * 4)
    : null;

  if (totalWeeks) {
    endDate = new Date(start);
    endDate.setDate(endDate.getDate() + (totalWeeks - 1) * 7);
  } else {
    // Cap at 3 months
    endDate = new Date(start);
    endDate.setMonth(endDate.getMonth() + MAX_TOTAL_MONTHS);
  }

  // Check availability for weeks 2 to N (week 1 is already booked via the normal booking flow)
  const futureWeeks = (totalWeeks || MAX_WEEKS_AHEAD) - 1; // Skip week 1
  const weeksToCreate = Math.min(futureWeeks, MAX_WEEKS_AHEAD);
  const availabilityChecks: Array<{ date: Date; available: boolean; conflicts: number[] }> = [];

  for (let i = 1; i <= weeksToCreate; i++) {
    const occurrenceDate = new Date(start);
    occurrenceDate.setDate(occurrenceDate.getDate() + i * 7);

    const { available, conflicts } = await checkSlotsAvailable(
      courtConfigId,
      occurrenceDate,
      hours
    );

    availabilityChecks.push({ date: occurrenceDate, available, conflicts });
  }

  const unavailable = availabilityChecks.filter((c) => !c.available);
  if (unavailable.length > 0) {
    const dateStr = formatBookingDate(unavailable[0].date, {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
    return {
      success: false,
      error: `Slots not available on ${dateStr}. Conflicting hours: ${unavailable[0].conflicts.join(", ")}`,
    };
  }

  // Create the recurring booking record and future bookings in a transaction
  // Week 1 is the booking already created via normal checkout — we link it after
  const result = await db.$transaction(async (tx) => {
    const recurringBooking = await tx.recurringBooking.create({
      data: {
        userId: session.user.id!,
        courtConfigId,
        startHour,
        endHour,
        dayOfWeek,
        startDate: start,
        endDate,
        mode: "weekly",
        status: "ACTIVE",
      },
    });

    // Link the existing first-week booking to this recurring series
    await tx.booking.updateMany({
      where: {
        userId: session.user.id!,
        courtConfigId,
        date: start,
        status: "CONFIRMED",
      },
      data: {
        recurringBookingId: recurringBooking.id,
      },
    });

    // Create individual bookings for weeks 2 onwards
    let bookingsCreated = 0;

    for (let i = 1; i <= weeksToCreate; i++) {
      const bookingDate = new Date(start);
      bookingDate.setDate(bookingDate.getDate() + i * 7);

      if (endDate && bookingDate > endDate) break;

      // Get slot prices for this date
      const slotPrices = await getSlotPricesForDate(courtConfigId, bookingDate);
      const bookingSlots = hours.map((hour) => {
        const priceData = slotPrices.find((p) => p.hour === hour);
        return { hour, price: priceData?.price ?? 0 };
      });

      const totalAmount = bookingSlots.reduce((sum, s) => sum + s.price, 0);

      await tx.booking.create({
        data: {
          userId: session.user.id!,
          courtConfigId,
          date: bookingDate,
          status: "CONFIRMED",
          totalAmount,
          recurringBookingId: recurringBooking.id,
          slots: {
            create: bookingSlots.map((s) => ({
              startHour: s.hour,
              price: s.price,
            })),
          },
          // Payment is captured in the first booking's payment (bundled recurring payment)
          // These bookings are CONFIRMED as pre-paid through the series
        },
      });

      bookingsCreated++;
    }

    return { recurringBookingId: recurringBooking.id, bookingsCreated: bookingsCreated + 1 }; // +1 for the first week
  }, { timeout: 20000 }); // Creating N future bookings with slots — give headroom over the 5s default.

  return {
    success: true,
    recurringBookingId: result.recurringBookingId,
    bookingsCreated: result.bookingsCreated,
  };
}

async function createDailyRecurringBooking(params: {
  userId: string;
  courtConfigId: string;
  startHour: number;
  endHour: number;
  dayOfWeek: number;
  start: Date;
  hours: number[];
  daysCount: number;
}): Promise<RecurringBookingResult> {
  const { userId, courtConfigId, startHour, endHour, dayOfWeek, start, hours, daysCount } = params;

  // Calculate end date for daily mode
  const endDate = new Date(start);
  endDate.setDate(endDate.getDate() + daysCount - 1);

  // Check availability for days 2 to N (day 1 is already booked via the normal booking flow)
  const futureDays = daysCount - 1; // Skip day 1
  const daysToCreate = Math.min(futureDays, MAX_DAYS_AHEAD);
  const availabilityChecks: Array<{ date: Date; available: boolean; conflicts: number[] }> = [];

  for (let i = 1; i <= daysToCreate; i++) {
    const occurrenceDate = new Date(start);
    occurrenceDate.setDate(occurrenceDate.getDate() + i); // increment by 1 day

    const { available, conflicts } = await checkSlotsAvailable(
      courtConfigId,
      occurrenceDate,
      hours
    );

    availabilityChecks.push({ date: occurrenceDate, available, conflicts });
  }

  const unavailable = availabilityChecks.filter((c) => !c.available);
  if (unavailable.length > 0) {
    const dateStr = formatBookingDate(unavailable[0].date, {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
    return {
      success: false,
      error: `Slots not available on ${dateStr}. Conflicting hours: ${unavailable[0].conflicts.join(", ")}`,
    };
  }

  // Create the recurring booking record and future bookings in a transaction
  const result = await db.$transaction(async (tx) => {
    const recurringBooking = await tx.recurringBooking.create({
      data: {
        userId,
        courtConfigId,
        startHour,
        endHour,
        dayOfWeek,
        startDate: start,
        endDate,
        mode: "daily",
        status: "ACTIVE",
      },
    });

    // Link the existing first-day booking to this recurring series
    await tx.booking.updateMany({
      where: {
        userId,
        courtConfigId,
        date: start,
        status: "CONFIRMED",
      },
      data: {
        recurringBookingId: recurringBooking.id,
      },
    });

    // Create individual bookings for days 2 onwards
    let bookingsCreated = 0;

    for (let i = 1; i <= daysToCreate; i++) {
      const bookingDate = new Date(start);
      bookingDate.setDate(bookingDate.getDate() + i);

      if (bookingDate > endDate) break;

      // Get slot prices for this date
      const slotPrices = await getSlotPricesForDate(courtConfigId, bookingDate);
      const bookingSlots = hours.map((hour) => {
        const priceData = slotPrices.find((p) => p.hour === hour);
        return { hour, price: priceData?.price ?? 0 };
      });

      const totalAmount = bookingSlots.reduce((sum, s) => sum + s.price, 0);

      await tx.booking.create({
        data: {
          userId,
          courtConfigId,
          date: bookingDate,
          status: "CONFIRMED",
          totalAmount,
          recurringBookingId: recurringBooking.id,
          slots: {
            create: bookingSlots.map((s) => ({
              startHour: s.hour,
              price: s.price,
            })),
          },
        },
      });

      bookingsCreated++;
    }

    return { recurringBookingId: recurringBooking.id, bookingsCreated: bookingsCreated + 1 }; // +1 for the first day
  }, { timeout: 20000 }); // Creating N future bookings with slots — give headroom over the 5s default.

  return {
    success: true,
    recurringBookingId: result.recurringBookingId,
    bookingsCreated: result.bookingsCreated,
  };
}

export async function cancelRecurringBooking(
  recurringBookingId: string
): Promise<RecurringBookingResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  const recurringBooking = await db.recurringBooking.findUnique({
    where: { id: recurringBookingId },
  });

  if (!recurringBooking) {
    return { success: false, error: "Recurring booking not found" };
  }

  if (recurringBooking.userId !== session.user.id) {
    return { success: false, error: "Unauthorized" };
  }

  if (recurringBooking.status === "CANCELLED") {
    return { success: false, error: "Already cancelled" };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Cancel all future individual bookings and the recurring record
  await db.$transaction([
    db.booking.updateMany({
      where: {
        recurringBookingId,
        date: { gte: today },
        status: { in: ["PENDING", "CONFIRMED"] },
      },
      data: { status: "CANCELLED" },
    }),
    db.recurringBooking.update({
      where: { id: recurringBookingId },
      data: { status: "CANCELLED" },
    }),
  ]);

  return { success: true };
}

export async function getUserRecurringBookings() {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated", bookings: [] };
  }

  const bookings = await db.recurringBooking.findMany({
    where: {
      userId: session.user.id,
      status: { in: ["ACTIVE", "PAUSED"] },
    },
    include: {
      courtConfig: {
        select: { sport: true, size: true, label: true },
      },
      bookings: {
        where: {
          date: { gte: new Date() },
          status: "CONFIRMED",
        },
        orderBy: { date: "asc" },
        take: 4,
        select: { id: true, date: true, totalAmount: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return { success: true, bookings };
}

export async function getRecurringBookingDetails(id: string) {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated", booking: null };
  }

  const booking = await db.recurringBooking.findUnique({
    where: { id },
    include: {
      courtConfig: {
        select: { sport: true, size: true, label: true, position: true },
      },
      bookings: {
        orderBy: { date: "asc" },
        select: {
          id: true,
          date: true,
          status: true,
          totalAmount: true,
          slots: { orderBy: { startHour: "asc" } },
        },
      },
    },
  });

  if (!booking) {
    return { success: false, error: "Recurring booking not found", booking: null };
  }

  if (booking.userId !== session.user.id) {
    return { success: false, error: "Unauthorized", booking: null };
  }

  return { success: true, booking };
}
