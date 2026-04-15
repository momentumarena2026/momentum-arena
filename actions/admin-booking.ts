"use server";

import { db } from "@/lib/db";
import { sendBookingConfirmation } from "@/lib/notifications";
import { requireAdmin as requireAdminBase } from "@/lib/admin-auth";

async function requireAdmin() {
  const user = await requireAdminBase("MANAGE_BOOKINGS");
  return user.id;
}

export async function confirmCashPayment(bookingId: string) {
  const adminId = await requireAdmin();

  const payment = await db.payment.findUnique({
    where: { bookingId },
  });

  if (!payment || payment.method !== "CASH") {
    return { success: false, error: "Cash payment not found" };
  }

  await db.$transaction([
    db.payment.update({
      where: { id: payment.id },
      data: {
        status: "COMPLETED",
        confirmedBy: adminId,
        confirmedAt: new Date(),
      },
    }),
    db.booking.update({
      where: { id: bookingId },
      data: { status: "CONFIRMED" },
    }),
  ]);

  // Send booking confirmation to the customer
  await sendBookingConfirmation(bookingId);

  return { success: true };
}

export async function confirmUpiPayment(bookingId: string) {
  const adminId = await requireAdmin();

  const payment = await db.payment.findUnique({
    where: { bookingId },
    include: { booking: true },
  });

  if (!payment || payment.method !== "UPI_QR") {
    return { success: false, error: "UPI payment not found" };
  }

  await db.$transaction([
    db.payment.update({
      where: { id: payment.id },
      data: {
        status: "COMPLETED",
        confirmedBy: adminId,
        confirmedAt: new Date(),
      },
    }),
    db.booking.update({
      where: { id: bookingId },
      data: { status: "CONFIRMED" },
    }),
  ]);

  // Send booking confirmation to the customer
  await sendBookingConfirmation(bookingId);

  return { success: true };
}

export async function cancelBooking(bookingId: string, reason: string) {
  const adminId = await requireAdmin();

  if (!reason.trim()) {
    return { success: false, error: "Cancellation reason is required" };
  }

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { payment: true, slots: true },
  });

  if (!booking) {
    return { success: false, error: "Booking not found" };
  }

  if (booking.status === "CANCELLED") {
    return { success: false, error: "Booking is already cancelled" };
  }

  // Cancel booking — frees the slot, no refund
  await db.$transaction([
    db.booking.update({
      where: { id: bookingId },
      data: { status: "CANCELLED" },
    }),
  ]);

  return { success: true };
}

export async function refundBooking(
  bookingId: string,
  reason: string,
  refundMethod?: "ORIGINAL" | "CASH" | "UPI" | "BANK_TRANSFER",
  refundAmount?: number
) {
  const adminId = await requireAdmin();

  if (!reason.trim()) {
    return { success: false, error: "Refund reason is required" };
  }

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { payment: true, slots: { orderBy: { startHour: "asc" } } },
  });

  if (!booking) {
    return { success: false, error: "Booking not found" };
  }

  if (!booking.payment) {
    return { success: false, error: "No payment found for this booking" };
  }

  if (booking.payment.status === "REFUNDED") {
    return { success: false, error: "Payment is already refunded" };
  }

  const actualRefundAmount = refundAmount ?? booking.payment.amount;
  const isPartialRefund = actualRefundAmount < booking.payment.amount;
  const refundMethodStr = refundMethod || "ORIGINAL";

  await db.$transaction([
    db.booking.update({
      where: { id: bookingId },
      data: { status: "CANCELLED" },
    }),
    db.payment.update({
      where: { id: booking.payment.id },
      data: {
        status: "REFUNDED",
        refundedBy: adminId,
        refundedAt: new Date(),
        refundReason: `[${refundMethodStr}]${isPartialRefund ? ` [Partial: ₹${(actualRefundAmount / 100).toFixed(0)}]` : ""} ${reason}`,
      },
    }),
  ]);

  return { success: true };
}

export async function getAdminBookings(filters?: {
  date?: string;
  sport?: string;
  status?: string;
  paymentMethod?: string;
  page?: number;
  limit?: number;
}) {
  await requireAdmin();

  const page = filters?.page ?? 1;
  const limit = filters?.limit ?? 20;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};

  if (filters?.date) {
    where.date = new Date(filters.date);
  }
  if (filters?.status) {
    where.status = filters.status;
  }
  if (filters?.sport) {
    where.courtConfig = { sport: filters.sport };
  }

  const [bookings, total] = await Promise.all([
    db.booking.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, phone: true } },
        courtConfig: true,
        slots: { orderBy: { startHour: "asc" } },
        payment: true,
        recurringBooking: {
          include: {
            bookings: {
              where: { payment: { isNot: null } },
              include: { payment: true },
              take: 1,
              orderBy: { date: "asc" },
            },
          },
        },
      },
      orderBy: [{ createdAt: "desc" }],
      skip,
      take: limit,
    }),
    db.booking.count({ where }),
  ]);

  // For recurring child bookings without direct payment, inherit from the series' first booking
  const enrichedBookings = bookings.map((booking) => {
    if (!booking.payment && booking.recurringBooking?.bookings?.[0]?.payment) {
      return {
        ...booking,
        payment: booking.recurringBooking.bookings[0].payment,
        _isRecurringChildPayment: true,
      };
    }
    return { ...booking, _isRecurringChildPayment: false };
  });

  return { bookings: enrichedBookings, total, page, totalPages: Math.ceil(total / limit) };
}

export async function getAdminStats() {
  // Stats viewable by any admin (no specific permission required)
  const { requireAdmin: requireAdminNoPermission } = await import("@/lib/admin-auth");
  await requireAdminNoPermission();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [
    totalBookings,
    todayBookings,
    totalUsers,
    todayRevenue,
    pendingPayments,
  ] = await Promise.all([
    db.booking.count({ where: { status: "CONFIRMED" } }),
    db.booking.count({
      where: { date: today, status: "CONFIRMED" },
    }),
    db.user.count({ where: { deletedAt: null } }),
    db.payment.aggregate({
      where: {
        status: "COMPLETED",
        confirmedAt: { gte: today, lt: tomorrow },
      },
      _sum: { amount: true },
    }),
    db.payment.count({ where: { status: "PENDING" } }),
  ]);

  return {
    totalBookings,
    todayBookings,
    totalUsers,
    todayRevenue: todayRevenue._sum.amount ?? 0,
    pendingPayments,
  };
}

// ---------------------------------------------------------------------------
// Extended admin booking actions
// ---------------------------------------------------------------------------

import { getSlotPricesForDate } from "@/lib/pricing";
import { zonesOverlap, OPERATING_HOURS } from "@/lib/court-config";
import { CourtZone } from "@prisma/client";

async function requireAdminWithDetails() {
  const user = await requireAdminBase("MANAGE_BOOKINGS");
  const adminUser = await db.adminUser.findFirst({ where: { id: user.id } });
  if (!adminUser) throw new Error("Admin user not found");
  return { id: adminUser.id, username: adminUser.username };
}

// ---------------------------------------------------------------------------
// searchCustomers
// ---------------------------------------------------------------------------
export async function searchCustomers(query: string) {
  await requireAdmin();

  try {
    const customers = await db.user.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { email: { contains: query, mode: "insensitive" } },
          { phone: { contains: query, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, email: true, phone: true },
      take: 10,
    });

    return { success: true as const, customers };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Failed to search customers",
    };
  }
}

// ---------------------------------------------------------------------------
// createCustomerForBooking
// ---------------------------------------------------------------------------
export async function createCustomerForBooking(data: {
  name: string;
  phone: string;
  email?: string;
}) {
  await requireAdmin();

  try {
    // Check if phone already exists
    const existing = await db.user.findUnique({
      where: { phone: data.phone },
    });
    if (existing) {
      return { success: true as const, userId: existing.id, isNew: false };
    }

    const newUser = await db.user.create({
      data: {
        name: data.name,
        phone: data.phone,
        email: data.email || null,
        role: "CUSTOMER",
      },
    });

    return { success: true as const, userId: newUser.id, isNew: true };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Failed to create customer",
    };
  }
}

// ---------------------------------------------------------------------------
// getAvailableSlots
// ---------------------------------------------------------------------------
export async function getAvailableSlots(
  courtConfigId: string,
  dateStr: string,
  excludeBookingId?: string
) {
  await requireAdmin();

  try {
    const dateOnly = new Date(dateStr + "T00:00:00Z");
    const now = new Date();

    // Get court config
    const config = await db.courtConfig.findUnique({
      where: { id: courtConfigId },
    });
    if (!config) return { success: false as const, error: "Court config not found" };
    if (!config.isActive) return { success: false as const, error: "Court is not active" };

    // Get all active bookings on that date
    const activeBookings = await db.booking.findMany({
      where: {
        date: dateOnly,
        OR: [
          { status: "CONFIRMED" },
          { status: "LOCKED", lockExpiresAt: { gt: now } },
        ],
        ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
      },
      include: {
        courtConfig: true,
        slots: true,
      },
    });

    // Filter by zone overlap
    const conflicting = activeBookings.filter((b) =>
      zonesOverlap(
        b.courtConfig.zones as CourtZone[],
        config.zones as CourtZone[]
      )
    );

    // Get occupied hours
    const occupiedHours = new Set<number>();
    for (const booking of conflicting) {
      for (const slot of booking.slots) {
        occupiedHours.add(slot.startHour);
      }
    }

    // Get slot blocks for the date
    const blocks = await db.slotBlock.findMany({
      where: {
        date: dateOnly,
        OR: [
          { courtConfigId },
          { sport: config.sport },
          { courtConfigId: null, sport: null },
        ],
      },
    });

    const blockedHours = new Set<number>();
    let fullDayBlocked = false;
    for (const block of blocks) {
      if (block.startHour === null) {
        fullDayBlocked = true;
        break;
      }
      blockedHours.add(block.startHour);
    }

    // Get slot prices
    const slotPrices = await getSlotPricesForDate(courtConfigId, dateOnly);
    const priceMap = new Map<number, number>(slotPrices.map((s) => [s.hour, s.price]));

    // Build result for each operating hour
    const slots: { hour: number; price: number; available: boolean; blocked: boolean }[] = [];
    for (let hour = OPERATING_HOURS.start; hour < OPERATING_HOURS.end; hour++) {
      const blocked = fullDayBlocked || blockedHours.has(hour);
      const occupied = occupiedHours.has(hour);
      slots.push({
        hour,
        price: priceMap.get(hour) ?? 0,
        available: !blocked && !occupied,
        blocked,
      });
    }

    return { success: true as const, slots };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Failed to get available slots",
    };
  }
}

// ---------------------------------------------------------------------------
// adminCreateBooking
// ---------------------------------------------------------------------------
export async function adminCreateBooking(data: {
  courtConfigId: string;
  date: string;
  hours: number[];
  userId: string;
  paymentMethod: "CASH" | "UPI_QR" | "RAZORPAY" | "FREE";
  razorpayPaymentId?: string;
  note?: string;
}) {
  const admin = await requireAdminWithDetails();

  try {
    // Validate hours
    const validMethods = ["CASH", "UPI_QR", "RAZORPAY", "FREE"] as const;
    if (!validMethods.includes(data.paymentMethod)) {
      return { success: false as const, error: "Invalid payment method" };
    }
    for (const h of data.hours) {
      if (h < OPERATING_HOURS.start || h >= OPERATING_HOURS.end) {
        return { success: false as const, error: `Invalid hour: ${h}` };
      }
    }
    if (data.hours.length === 0) {
      return { success: false as const, error: "At least one hour is required" };
    }

    const dateOnly = new Date(data.date + "T00:00:00Z");
    const now = new Date();

    // Get config
    const config = await db.courtConfig.findUnique({
      where: { id: data.courtConfigId },
    });
    if (!config) return { success: false as const, error: "Court config not found" };
    if (!config.isActive) return { success: false as const, error: "Court is not active" };

    // Get slot prices
    const slotPrices = await getSlotPricesForDate(data.courtConfigId, dateOnly);
    const priceMap = new Map<number, number>(slotPrices.map((s) => [s.hour, s.price]));

    // Check availability
    const activeBookings = await db.booking.findMany({
      where: {
        date: dateOnly,
        OR: [
          { status: "CONFIRMED" },
          { status: "LOCKED", lockExpiresAt: { gt: now } },
        ],
      },
      include: { courtConfig: true, slots: true },
    });

    const conflicting = activeBookings.filter((b) =>
      zonesOverlap(
        b.courtConfig.zones as CourtZone[],
        config.zones as CourtZone[]
      )
    );

    const occupiedHours = new Set<number>();
    for (const booking of conflicting) {
      for (const slot of booking.slots) {
        occupiedHours.add(slot.startHour);
      }
    }

    const hourConflicts = data.hours.filter((h) => occupiedHours.has(h));
    if (hourConflicts.length > 0) {
      return { success: false as const, error: `Slots already booked: ${hourConflicts.join(", ")}` };
    }

    // Check slot blocks
    const blocks = await db.slotBlock.findMany({
      where: {
        date: dateOnly,
        OR: [
          { courtConfigId: data.courtConfigId },
          { sport: config.sport },
          { courtConfigId: null, sport: null },
        ],
      },
    });

    for (const block of blocks) {
      if (block.startHour === null) {
        return { success: false as const, error: "This court is blocked for the entire day" };
      }
      if (data.hours.includes(block.startHour)) {
        return { success: false as const, error: `Slot at hour ${block.startHour} is blocked` };
      }
    }

    // Calculate total
    const totalAmount = data.hours.reduce((sum, h) => sum + (priceMap.get(h) ?? 0), 0);

    // Create in transaction
    const bookingId = await db.$transaction(async (tx) => {
      // Create booking
      const booking = await tx.booking.create({
        data: {
          userId: data.userId,
          courtConfigId: data.courtConfigId,
          date: dateOnly,
          status: "CONFIRMED",
          totalAmount,
          createdByAdminId: admin.id,
          slots: {
            create: data.hours.map((h) => ({
              startHour: h,
              price: priceMap.get(h) ?? 0,
            })),
          },
        },
      });

      // Create payment based on method
      if (data.paymentMethod === "FREE") {
        await tx.payment.create({
          data: {
            bookingId: booking.id,
            method: "FREE",
            status: "COMPLETED",
            amount: 0,
            confirmedBy: admin.id,
            confirmedAt: now,
          },
        });
      } else if (data.paymentMethod === "RAZORPAY") {
        await tx.payment.create({
          data: {
            bookingId: booking.id,
            method: "RAZORPAY",
            status: "COMPLETED",
            amount: totalAmount,
            razorpayPaymentId: data.razorpayPaymentId ?? null,
            confirmedBy: admin.id,
            confirmedAt: now,
          },
        });
      } else {
        // CASH or UPI_QR
        await tx.payment.create({
          data: {
            bookingId: booking.id,
            method: data.paymentMethod,
            status: "PENDING",
            amount: totalAmount,
          },
        });
      }

      // Create edit history
      await tx.bookingEditHistory.create({
        data: {
          bookingId: booking.id,
          adminId: admin.id,
          adminUsername: admin.username,
          editType: "CREATED",
          newDate: dateOnly,
          newSlots: data.hours,
          newCourtConfigId: data.courtConfigId,
          newAmount: data.paymentMethod === "FREE" ? 0 : totalAmount,
          note: data.note ?? null,
        },
      });

      return booking.id;
    });

    // Send confirmation SMS if booking is confirmed (FREE or RAZORPAY)
    if (data.paymentMethod === "FREE" || data.paymentMethod === "RAZORPAY") {
      sendBookingConfirmation(bookingId).catch(console.error);
    }

    return { success: true as const, bookingId };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Failed to create booking",
    };
  }
}

// ---------------------------------------------------------------------------
// adminEditBookingSlots
// ---------------------------------------------------------------------------
export async function adminEditBookingSlots(
  bookingId: string,
  newHours: number[]
) {
  const admin = await requireAdminWithDetails();

  try {
    if (newHours.length === 0) {
      return { success: false as const, error: "At least one hour is required" };
    }
    for (const h of newHours) {
      if (h < OPERATING_HOURS.start || h >= OPERATING_HOURS.end) {
        return { success: false as const, error: `Invalid hour: ${h}` };
      }
    }

    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      include: { slots: true, courtConfig: true, payment: true },
    });

    if (!booking) return { success: false as const, error: "Booking not found" };
    if (booking.status !== "CONFIRMED") {
      return { success: false as const, error: "Only confirmed bookings can be edited" };
    }

    const dateOnly = booking.date;
    const now = new Date();
    const config = booking.courtConfig;

    // Check availability excluding current booking
    const activeBookings = await db.booking.findMany({
      where: {
        date: dateOnly,
        id: { not: bookingId },
        OR: [
          { status: "CONFIRMED" },
          { status: "LOCKED", lockExpiresAt: { gt: now } },
        ],
      },
      include: { courtConfig: true, slots: true },
    });

    const conflicting = activeBookings.filter((b) =>
      zonesOverlap(
        b.courtConfig.zones as CourtZone[],
        config.zones as CourtZone[]
      )
    );

    const occupiedHours = new Set<number>();
    for (const b of conflicting) {
      for (const slot of b.slots) {
        occupiedHours.add(slot.startHour);
      }
    }

    const hourConflicts = newHours.filter((h) => occupiedHours.has(h));
    if (hourConflicts.length > 0) {
      return { success: false as const, error: `Slots already booked: ${hourConflicts.join(", ")}` };
    }

    // Check slot blocks
    const blocks = await db.slotBlock.findMany({
      where: {
        date: dateOnly,
        OR: [
          { courtConfigId: config.id },
          { sport: config.sport },
          { courtConfigId: null, sport: null },
        ],
      },
    });

    for (const block of blocks) {
      if (block.startHour === null) {
        return { success: false as const, error: "This court is blocked for the entire day" };
      }
      if (newHours.includes(block.startHour)) {
        return { success: false as const, error: `Slot at hour ${block.startHour} is blocked` };
      }
    }

    // Get new prices
    const slotPrices = await getSlotPricesForDate(config.id, dateOnly);
    const priceMap = new Map<number, number>(slotPrices.map((s) => [s.hour, s.price]));
    const newTotalAmount = newHours.reduce((sum, h) => sum + (priceMap.get(h) ?? 0), 0);
    const previousHours = booking.slots.map((s) => s.startHour).sort((a, b) => a - b);
    const previousAmount = booking.totalAmount;

    await db.$transaction(async (tx) => {
      // Delete old slots
      await tx.bookingSlot.deleteMany({ where: { bookingId } });

      // Create new slots
      await tx.bookingSlot.createMany({
        data: newHours.map((h) => ({
          bookingId,
          startHour: h,
          price: priceMap.get(h) ?? 0,
        })),
      });

      // Update booking total
      await tx.booking.update({
        where: { id: bookingId },
        data: { totalAmount: newTotalAmount },
      });

      // Update payment amount if exists
      if (booking.payment) {
        await tx.payment.update({
          where: { id: booking.payment.id },
          data: { amount: newTotalAmount },
        });
      }

      // Create edit history
      await tx.bookingEditHistory.create({
        data: {
          bookingId,
          adminId: admin.id,
          adminUsername: admin.username,
          editType: "SLOTS_CHANGED",
          previousSlots: previousHours,
          newSlots: newHours,
          previousAmount,
          newAmount: newTotalAmount,
        },
      });
    });

    return { success: true as const };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Failed to edit booking slots",
    };
  }
}

// ---------------------------------------------------------------------------
// adminEditBookingFull
// ---------------------------------------------------------------------------
export async function adminEditBookingFull(
  bookingId: string,
  data: {
    newDate?: string;
    newCourtConfigId?: string;
    newHours?: number[];
  }
) {
  const admin = await requireAdminWithDetails();

  try {
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      include: { slots: true, courtConfig: true, payment: true },
    });

    if (!booking) return { success: false as const, error: "Booking not found" };
    if (!booking.createdByAdminId) {
      return { success: false as const, error: "Only admin-created bookings can be fully edited" };
    }
    if (booking.status !== "CONFIRMED") {
      return { success: false as const, error: "Only confirmed bookings can be edited" };
    }

    // Determine final values
    const finalDate = data.newDate
      ? new Date(data.newDate + "T00:00:00Z")
      : booking.date;
    const finalCourtConfigId = data.newCourtConfigId ?? booking.courtConfigId;
    const finalHours = data.newHours ?? booking.slots.map((s) => s.startHour);

    // Validate hours
    for (const h of finalHours) {
      if (h < OPERATING_HOURS.start || h >= OPERATING_HOURS.end) {
        return { success: false as const, error: `Invalid hour: ${h}` };
      }
    }
    if (finalHours.length === 0) {
      return { success: false as const, error: "At least one hour is required" };
    }

    // Get final config
    const finalConfig = finalCourtConfigId === booking.courtConfigId
      ? booking.courtConfig
      : await db.courtConfig.findUnique({ where: { id: finalCourtConfigId } });

    if (!finalConfig) return { success: false as const, error: "Court config not found" };
    if (!finalConfig.isActive) return { success: false as const, error: "Court is not active" };

    const now = new Date();

    // Check availability excluding current booking
    const activeBookings = await db.booking.findMany({
      where: {
        date: finalDate,
        id: { not: bookingId },
        OR: [
          { status: "CONFIRMED" },
          { status: "LOCKED", lockExpiresAt: { gt: now } },
        ],
      },
      include: { courtConfig: true, slots: true },
    });

    const conflicting = activeBookings.filter((b) =>
      zonesOverlap(
        b.courtConfig.zones as CourtZone[],
        finalConfig.zones as CourtZone[]
      )
    );

    const occupiedHours = new Set<number>();
    for (const b of conflicting) {
      for (const slot of b.slots) {
        occupiedHours.add(slot.startHour);
      }
    }

    const hourConflicts = finalHours.filter((h) => occupiedHours.has(h));
    if (hourConflicts.length > 0) {
      return { success: false as const, error: `Slots already booked: ${hourConflicts.join(", ")}` };
    }

    // Check slot blocks
    const blocks = await db.slotBlock.findMany({
      where: {
        date: finalDate,
        OR: [
          { courtConfigId: finalCourtConfigId },
          { sport: finalConfig.sport },
          { courtConfigId: null, sport: null },
        ],
      },
    });

    for (const block of blocks) {
      if (block.startHour === null) {
        return { success: false as const, error: "This court is blocked for the entire day" };
      }
      if (finalHours.includes(block.startHour)) {
        return { success: false as const, error: `Slot at hour ${block.startHour} is blocked` };
      }
    }

    // Get new prices
    const slotPrices = await getSlotPricesForDate(finalCourtConfigId, finalDate);
    const priceMap = new Map<number, number>(slotPrices.map((s) => [s.hour, s.price]));
    const newTotalAmount = finalHours.reduce((sum, h) => sum + (priceMap.get(h) ?? 0), 0);

    const previousHours = booking.slots.map((s) => s.startHour).sort((a, b) => a - b);
    const previousAmount = booking.totalAmount;

    await db.$transaction(async (tx) => {
      // Update booking
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          date: finalDate,
          courtConfigId: finalCourtConfigId,
          totalAmount: newTotalAmount,
        },
      });

      // Delete old slots, create new
      await tx.bookingSlot.deleteMany({ where: { bookingId } });
      await tx.bookingSlot.createMany({
        data: finalHours.map((h) => ({
          bookingId,
          startHour: h,
          price: priceMap.get(h) ?? 0,
        })),
      });

      // Update payment amount if exists
      if (booking.payment) {
        await tx.payment.update({
          where: { id: booking.payment.id },
          data: { amount: newTotalAmount },
        });
      }

      // Create edit history entries for each change type
      if (data.newDate && finalDate.getTime() !== booking.date.getTime()) {
        await tx.bookingEditHistory.create({
          data: {
            bookingId,
            adminId: admin.id,
            adminUsername: admin.username,
            editType: "DATE_CHANGED",
            previousDate: booking.date,
            newDate: finalDate,
            previousSlots: previousHours,
            newSlots: finalHours,
            previousAmount,
            newAmount: newTotalAmount,
          },
        });
      }

      if (data.newCourtConfigId && finalCourtConfigId !== booking.courtConfigId) {
        await tx.bookingEditHistory.create({
          data: {
            bookingId,
            adminId: admin.id,
            adminUsername: admin.username,
            editType: "COURT_CHANGED",
            previousCourtConfigId: booking.courtConfigId,
            newCourtConfigId: finalCourtConfigId,
            previousSlots: previousHours,
            newSlots: finalHours,
            previousAmount,
            newAmount: newTotalAmount,
          },
        });
      }

      if (data.newHours) {
        const sortedPrevious = [...previousHours].sort((a, b) => a - b);
        const sortedNew = [...finalHours].sort((a, b) => a - b);
        const slotsChanged =
          sortedPrevious.length !== sortedNew.length ||
          sortedPrevious.some((h, i) => h !== sortedNew[i]);

        if (slotsChanged) {
          await tx.bookingEditHistory.create({
            data: {
              bookingId,
              adminId: admin.id,
              adminUsername: admin.username,
              editType: "SLOTS_CHANGED",
              previousSlots: previousHours,
              newSlots: finalHours,
              previousAmount,
              newAmount: newTotalAmount,
            },
          });
        }
      }
    });

    return { success: true as const };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Failed to edit booking",
    };
  }
}

// ---------------------------------------------------------------------------
// getBookingEditHistory
// ---------------------------------------------------------------------------
export async function getBookingEditHistory(bookingId: string) {
  await requireAdmin();

  try {
    const history = await db.bookingEditHistory.findMany({
      where: { bookingId },
      orderBy: { createdAt: "desc" },
    });

    return { success: true as const, history };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Failed to get edit history",
    };
  }
}
