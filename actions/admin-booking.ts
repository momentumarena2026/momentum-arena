"use server";

import { db } from "@/lib/db";
import {
  sendBookingConfirmation,
  notifyAdminBookingConfirmed,
} from "@/lib/notifications";
import { requireAdmin as requireAdminBase } from "@/lib/admin-auth";
import { normalizeIndianPhone } from "@/lib/phone";

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

  // Partial bookings land on PARTIAL (advance verified, remainder still
  // owed at venue); full bookings go straight to COMPLETED.
  const nextStatus = payment.isPartialPayment ? "PARTIAL" : "COMPLETED";

  await db.$transaction([
    db.payment.update({
      where: { id: payment.id },
      data: {
        status: nextStatus,
        confirmedBy: adminId,
        confirmedAt: new Date(),
      },
    }),
    db.booking.update({
      where: { id: bookingId },
      data: { status: "CONFIRMED" },
    }),
  ]);

  // Send booking confirmation to the customer + ping admins
  await sendBookingConfirmation(bookingId);
  notifyAdminBookingConfirmed(bookingId).catch((err) => console.error("Notification dispatch failed:", err));

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

  const nextStatus = payment.isPartialPayment ? "PARTIAL" : "COMPLETED";

  await db.$transaction([
    db.payment.update({
      where: { id: payment.id },
      data: {
        status: nextStatus,
        confirmedBy: adminId,
        confirmedAt: new Date(),
      },
    }),
    db.booking.update({
      where: { id: bookingId },
      data: { status: "CONFIRMED" },
    }),
  ]);

  // Send booking confirmation to the customer + ping admins
  await sendBookingConfirmation(bookingId);
  notifyAdminBookingConfirmed(bookingId).catch((err) => console.error("Notification dispatch failed:", err));

  return { success: true };
}

// Describe how the remainder was actually collected at the venue: the
// amount paid in cash and the amount paid via UPI QR. Either can be zero
// but not both; the sum must equal the remaining amount owed.
export type RemainderSplit = {
  cashAmount: number;
  upiAmount: number;
};

function describeSplit(cash: number, upi: number): string {
  if (cash > 0 && upi > 0) {
    return `Rs.${cash} Cash + Rs.${upi} UPI QR`;
  }
  if (cash > 0) return `Rs.${cash} Cash`;
  return `Rs.${upi} UPI QR`;
}

// Mark the venue-side remainder of a partial-payment booking as collected.
// Accepts a split between cash and UPI QR (either can be 0 but the sum
// must equal the remainder owed). Adds the full remainder to
// Payment.amount, zeroes remainingAmount so the "Cash Due at Venue" KPI
// and per-row chips drop off, flips status to COMPLETED, and writes an
// audit row in BookingEditHistory. `remainderMethod` is set to CASH or
// UPI_QR when the collection was single-method (for back-compat with
// display code) and left null when the collection was split.
export async function markRemainderCollected(
  bookingId: string,
  split: RemainderSplit
) {
  const adminId = await requireAdmin();

  const cashAmount = Math.trunc(split.cashAmount ?? 0);
  const upiAmount = Math.trunc(split.upiAmount ?? 0);
  if (cashAmount < 0 || upiAmount < 0) {
    return { success: false, error: "Amounts cannot be negative" };
  }
  if (cashAmount === 0 && upiAmount === 0) {
    return { success: false, error: "Enter at least one amount" };
  }

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { payment: true },
  });
  if (!booking) return { success: false, error: "Booking not found" };
  if (!booking.payment) return { success: false, error: "No payment on this booking" };
  if (!booking.payment.isPartialPayment) {
    return { success: false, error: "Booking is not a partial payment" };
  }
  const remaining = booking.payment.remainingAmount ?? 0;
  if (remaining <= 0) {
    return { success: false, error: "Remainder already collected" };
  }
  if (cashAmount + upiAmount !== remaining) {
    return {
      success: false,
      error: `Split must total Rs.${remaining} (got Rs.${cashAmount + upiAmount})`,
    };
  }

  const admin = await db.adminUser.findUnique({ where: { id: adminId } });
  const adminUsername = admin?.username ?? "unknown";

  const singleMethod =
    cashAmount > 0 && upiAmount === 0
      ? "CASH"
      : upiAmount > 0 && cashAmount === 0
      ? "UPI_QR"
      : null;

  await db.$transaction([
    db.payment.update({
      where: { id: booking.payment.id },
      data: {
        amount: booking.payment.amount + remaining,
        remainingAmount: 0,
        remainderMethod: singleMethod,
        remainderCashAmount: cashAmount,
        remainderUpiAmount: upiAmount,
        // PARTIAL -> COMPLETED now that the venue collection has been
        // recorded. Idempotent: if a prior state was already COMPLETED
        // (legacy rows), this is a no-op write.
        status: "COMPLETED",
      },
    }),
    db.bookingEditHistory.create({
      data: {
        bookingId,
        adminId,
        adminUsername,
        editType: "REMAINDER_COLLECTED",
        note: `Collected remaining Rs.${remaining} at venue: ${describeSplit(cashAmount, upiAmount)}`,
      },
    }),
  ]);

  return { success: true };
}

// Edit the cash/UPI split on a partial-payment booking whose remainder has
// already been collected. Does not change how much was collected — only
// re-attributes the same total between cash and UPI. Used to correct
// admin entry mistakes after the fact. Leaves Payment.amount /
// remainingAmount / status untouched; updates the two split columns and
// remainderMethod, and records an audit row with the before/after values.
export async function updateRemainderSplit(
  bookingId: string,
  split: RemainderSplit
) {
  const adminId = await requireAdmin();

  const cashAmount = Math.trunc(split.cashAmount ?? 0);
  const upiAmount = Math.trunc(split.upiAmount ?? 0);
  if (cashAmount < 0 || upiAmount < 0) {
    return { success: false, error: "Amounts cannot be negative" };
  }

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { payment: true },
  });
  if (!booking) return { success: false, error: "Booking not found" };
  if (!booking.payment) return { success: false, error: "No payment on this booking" };
  if (!booking.payment.isPartialPayment) {
    return { success: false, error: "Booking is not a partial payment" };
  }
  if ((booking.payment.remainingAmount ?? 0) > 0) {
    return { success: false, error: "Remainder not yet collected" };
  }

  // The total collected at the venue is the advance-less portion of the
  // booking total. Reject any split that doesn't sum to that.
  const advance = booking.payment.advanceAmount ?? 0;
  const venueTotal = booking.totalAmount - advance;
  if (cashAmount + upiAmount !== venueTotal) {
    return {
      success: false,
      error: `Split must total Rs.${venueTotal} (got Rs.${cashAmount + upiAmount})`,
    };
  }
  if (cashAmount === 0 && upiAmount === 0) {
    return { success: false, error: "Enter at least one amount" };
  }

  const priorCash =
    booking.payment.remainderCashAmount ??
    (booking.payment.remainderMethod === "CASH" ? venueTotal : 0);
  const priorUpi =
    booking.payment.remainderUpiAmount ??
    (booking.payment.remainderMethod === "UPI_QR" ? venueTotal : 0);
  if (priorCash === cashAmount && priorUpi === upiAmount) {
    return { success: false, error: "No changes to save" };
  }

  const admin = await db.adminUser.findUnique({ where: { id: adminId } });
  const adminUsername = admin?.username ?? "unknown";

  const singleMethod =
    cashAmount > 0 && upiAmount === 0
      ? "CASH"
      : upiAmount > 0 && cashAmount === 0
      ? "UPI_QR"
      : null;

  await db.$transaction([
    db.payment.update({
      where: { id: booking.payment.id },
      data: {
        remainderMethod: singleMethod,
        remainderCashAmount: cashAmount,
        remainderUpiAmount: upiAmount,
      },
    }),
    db.bookingEditHistory.create({
      data: {
        bookingId,
        adminId,
        adminUsername,
        editType: "REMAINDER_SPLIT_EDITED",
        note: `Updated venue collection split from ${describeSplit(priorCash, priorUpi)} to ${describeSplit(cashAmount, upiAmount)}`,
      },
    }),
  ]);

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
    totalRevenue,
    pendingPayments,
    venueDueAgg,
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
    db.payment.aggregate({
      where: {
        status: "COMPLETED",
        booking: { status: "CONFIRMED" },
      },
      _sum: { amount: true },
    }),
    db.payment.count({ where: { status: "PENDING" } }),
    // Cash-due-at-venue from confirmed partial-payment bookings. Only
    // counts advance-paid bookings whose remainder hasn't been collected
    // yet (remainingAmount > 0). Scoped to CONFIRMED bookings so cancelled
    // ones drop out.
    db.payment.aggregate({
      where: {
        isPartialPayment: true,
        remainingAmount: { gt: 0 },
        booking: { status: "CONFIRMED" },
      },
      _sum: { remainingAmount: true },
    }),
  ]);

  return {
    totalBookings,
    todayBookings,
    totalUsers,
    todayRevenue: todayRevenue._sum.amount ?? 0,
    totalRevenue: totalRevenue._sum.amount ?? 0,
    pendingPayments,
    venueDueTotal: venueDueAgg._sum.remainingAmount ?? 0,
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
    // Client-side PhoneInput already caps at 10 digits, but we normalize
    // + validate here so callers (including any future direct imports)
    // can't store a bare 10-digit number that later gets mis-parsed by
    // MSG91.
    const phone = normalizeIndianPhone(data.phone);
    if (phone.length !== 12 || !phone.startsWith("91")) {
      return {
        success: false as const,
        error: "Phone number must be a 10-digit Indian mobile number",
      };
    }

    // Check if phone already exists
    const existing = await db.user.findUnique({
      where: { phone },
    });
    if (existing) {
      return { success: true as const, userId: existing.id, isNew: false };
    }

    const newUser = await db.user.create({
      data: {
        name: data.name,
        phone,
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
        status: { in: ["CONFIRMED", "PENDING"] },
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
  // Optional advance amount — when > 0 and < totalAmount, the booking is
  // recorded as a partial payment: Payment.isPartialPayment = true,
  // Payment.amount = advanceAmount, remainingAmount = total - advance, and
  // paymentMethod represents HOW the advance was collected (static QR,
  // cash in hand, manual Razorpay, etc.). The remainder is expected in
  // cash at the venue. Cannot combine with FREE.
  advanceAmount?: number;
  // Optional override for the total amount. Admins need this when they've
  // negotiated a price with the customer that differs from the slot-by-slot
  // sum. When set, the computed slot total is preserved on
  // Booking.originalAmount for audit; totalAmount + Payment.amount reflect
  // the negotiated figure. Must be 0 for FREE bookings.
  customTotalAmount?: number;
  note?: string;
}) {
  const admin = await requireAdminWithDetails();

  try {
    // Validate hours
    const validMethods = ["CASH", "UPI_QR", "RAZORPAY", "FREE"] as const;
    if (!validMethods.includes(data.paymentMethod)) {
      return { success: false as const, error: "Invalid payment method" };
    }
    if (data.advanceAmount !== undefined) {
      if (data.paymentMethod === "FREE") {
        return { success: false as const, error: "Free bookings cannot have a partial payment" };
      }
      if (data.advanceAmount <= 0) {
        return { success: false as const, error: "Advance amount must be greater than zero" };
      }
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
        status: { in: ["CONFIRMED", "PENDING"] },
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

    // Calculate total from slot prices. `totalAmount` is the figure we
    // actually charge; `computedTotal` stays around so we can preserve it
    // on Booking.originalAmount when admin negotiates a different price.
    const computedTotal = data.hours.reduce(
      (sum, h) => sum + (priceMap.get(h) ?? 0),
      0
    );

    // Honour the negotiated override when provided. Reject nonsense inputs
    // (non-integers, negatives) and the FREE-but-nonzero combo.
    if (data.customTotalAmount !== undefined) {
      if (!Number.isInteger(data.customTotalAmount) || data.customTotalAmount < 0) {
        return {
          success: false as const,
          error: "Custom amount must be a non-negative integer",
        };
      }
      if (data.paymentMethod === "FREE" && data.customTotalAmount !== 0) {
        return {
          success: false as const,
          error: "Free bookings must have a total of ₹0",
        };
      }
    }

    const totalAmount =
      data.customTotalAmount !== undefined
        ? data.customTotalAmount
        : computedTotal;
    const isCustomAmount =
      data.customTotalAmount !== undefined &&
      data.customTotalAmount !== computedTotal;

    // Normalize partial-payment input once the total is known. A partial
    // amount equal to or greater than the total becomes a normal full
    // payment; anything less creates an advance-with-cash-remainder record.
    const rawAdvance = data.advanceAmount ?? 0;
    const isPartial = rawAdvance > 0 && rawAdvance < totalAmount;
    const advanceAmount = isPartial ? rawAdvance : undefined;
    const remainingAmount = isPartial ? totalAmount - rawAdvance : undefined;

    // Create in transaction
    const bookingId = await db.$transaction(async (tx) => {
      // Create booking. When the admin negotiated a different total, we
      // stash the slot-sum on originalAmount so the audit view can surface
      // the delta.
      const booking = await tx.booking.create({
        data: {
          userId: data.userId,
          courtConfigId: data.courtConfigId,
          date: dateOnly,
          status: "CONFIRMED",
          totalAmount,
          originalAmount: isCustomAmount ? computedTotal : null,
          createdByAdminId: admin.id,
          slots: {
            create: data.hours.map((h) => ({
              startHour: h,
              price: priceMap.get(h) ?? 0,
            })),
          },
        },
      });

      // Create payment based on method / partial flag
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
      } else if (isPartial) {
        // Admin confirmed receipt of the advance in the chosen method.
        // Booking is CONFIRMED; status lands on PARTIAL (advance in, rest
        // owed at venue) and flips to COMPLETED via markRemainderCollected
        // once the cash is collected.
        await tx.payment.create({
          data: {
            bookingId: booking.id,
            method: data.paymentMethod,
            status: "PARTIAL",
            amount: advanceAmount!,
            isPartialPayment: true,
            advanceAmount: advanceAmount!,
            remainingAmount: remainingAmount!,
            razorpayPaymentId:
              data.paymentMethod === "RAZORPAY" ? (data.razorpayPaymentId ?? null) : null,
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
        // CASH or UPI_QR full payment, admin not yet confirming receipt
        await tx.payment.create({
          data: {
            bookingId: booking.id,
            method: data.paymentMethod,
            status: "PENDING",
            amount: totalAmount,
          },
        });
      }

      // Create edit history. When admin negotiated a different price, fold
      // that into the note so the audit log tells the whole story.
      const creationNotes: string[] = [];
      if (data.note?.trim()) creationNotes.push(data.note.trim());
      if (isCustomAmount) {
        creationNotes.push(
          `Negotiated price: ₹${totalAmount} (computed: ₹${computedTotal})`
        );
      }

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
          note: creationNotes.length > 0 ? creationNotes.join(" · ") : null,
        },
      });

      return booking.id;
    });

    // Send confirmation SMS for bookings whose Payment row landed in a
    // terminal COMPLETED state — FREE, RAZORPAY (full), and any partial
    // payment (where admin confirmed receipt of the advance).
    const paymentIsCompleted =
      data.paymentMethod === "FREE" ||
      data.paymentMethod === "RAZORPAY" ||
      isPartial;
    if (paymentIsCompleted) {
      sendBookingConfirmation(bookingId).catch(console.error);
      notifyAdminBookingConfirmed(bookingId).catch((err) => console.error("Notification dispatch failed:", err));
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
  newHours: number[],
  // Optional new date for the booking. When provided, the slot grid is
  // re-validated against the target date (availability, blocks, pricing).
  // Passing undefined keeps the booking's current date.
  newDate?: string
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

    const dateOnly = newDate
      ? new Date(newDate + "T00:00:00Z")
      : booking.date;
    const dateChanged = dateOnly.getTime() !== booking.date.getTime();
    const config = booking.courtConfig;

    // Check availability excluding current booking
    const activeBookings = await db.booking.findMany({
      where: {
        date: dateOnly,
        id: { not: bookingId },
        status: { in: ["CONFIRMED", "PENDING"] },
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

      // Update booking total and (if the admin moved it) the date.
      await tx.booking.update({
        where: { id: bookingId },
        data: dateChanged
          ? { totalAmount: newTotalAmount, date: dateOnly }
          : { totalAmount: newTotalAmount },
      });

      // Update payment amount if exists. Partial-payment bookings have
      // their own edit flow (adminEditBookingFull) that keeps advance +
      // remainder in sync; here we only touch non-partial payments so we
      // don't clobber the advance figure.
      if (booking.payment && !booking.payment.isPartialPayment) {
        await tx.payment.update({
          where: { id: booking.payment.id },
          data: { amount: newTotalAmount },
        });
      }

      // Emit a date-change entry first so the history stays chronologically
      // readable when both changed in the same save.
      if (dateChanged) {
        await tx.bookingEditHistory.create({
          data: {
            bookingId,
            adminId: admin.id,
            adminUsername: admin.username,
            editType: "DATE_CHANGED",
            previousDate: booking.date,
            newDate: dateOnly,
            previousSlots: previousHours,
            newSlots: newHours,
            previousAmount,
            newAmount: newTotalAmount,
          },
        });
      }

      const slotsChanged =
        previousHours.length !== newHours.length ||
        previousHours.some(
          (h, i) => h !== [...newHours].sort((a, b) => a - b)[i]
        );
      if (slotsChanged) {
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
      }
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
    // Partial-payment edits. Admin can correct the advance figure after the
    // booking is created (e.g. customer rounded up or paid a different
    // amount than originally recorded) or change the method (e.g. recorded
    // as Cash, actually came in via static QR).
    newAdvanceAmount?: number;
    newAdvanceMethod?: "CASH" | "UPI_QR";
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

    // Check availability excluding current booking
    const activeBookings = await db.booking.findMany({
      where: {
        date: finalDate,
        id: { not: bookingId },
        status: { in: ["CONFIRMED", "PENDING"] },
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

    // Advance edits only apply to existing partial payments that haven't
    // had the remainder collected yet. Reject if caller asked for changes
    // but the booking isn't in that state.
    const isEditingAdvance =
      data.newAdvanceAmount !== undefined || data.newAdvanceMethod !== undefined;
    if (isEditingAdvance) {
      if (!booking.payment || !booking.payment.isPartialPayment) {
        return { success: false as const, error: "Booking is not a partial payment" };
      }
      if (booking.payment.status !== "PARTIAL") {
        return { success: false as const, error: "Advance can only be edited while payment is PARTIAL" };
      }
    }

    const previousAdvance = booking.payment?.advanceAmount ?? null;
    const previousAdvanceMethod = booking.payment?.method ?? null;

    const finalAdvance =
      data.newAdvanceAmount !== undefined
        ? data.newAdvanceAmount
        : previousAdvance;
    const finalAdvanceMethod =
      data.newAdvanceMethod !== undefined
        ? data.newAdvanceMethod
        : previousAdvanceMethod;

    if (isEditingAdvance) {
      if (finalAdvance === null || !Number.isInteger(finalAdvance) || finalAdvance <= 0) {
        return { success: false as const, error: "Advance must be a positive integer" };
      }
      if (finalAdvance >= newTotalAmount) {
        return { success: false as const, error: "Advance must be less than the total amount" };
      }
    }

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

      // Update payment amount / advance fields if payment exists.
      if (booking.payment) {
        const paymentUpdate: {
          amount?: number;
          advanceAmount?: number;
          remainingAmount?: number;
          method?: "CASH" | "UPI_QR";
        } = {};

        if (booking.payment.isPartialPayment && finalAdvance !== null) {
          // Partial bookings: `amount` stores the advance collected, not
          // the slot total. Keep advanceAmount + remainingAmount in sync.
          paymentUpdate.amount = finalAdvance;
          paymentUpdate.advanceAmount = finalAdvance;
          paymentUpdate.remainingAmount = newTotalAmount - finalAdvance;
        } else {
          paymentUpdate.amount = newTotalAmount;
        }

        if (data.newAdvanceMethod) {
          paymentUpdate.method = data.newAdvanceMethod;
        }

        await tx.payment.update({
          where: { id: booking.payment.id },
          data: paymentUpdate,
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

      if (isEditingAdvance) {
        const amountChanged =
          data.newAdvanceAmount !== undefined &&
          data.newAdvanceAmount !== previousAdvance;
        const methodChanged =
          data.newAdvanceMethod !== undefined &&
          data.newAdvanceMethod !== previousAdvanceMethod;
        if (amountChanged || methodChanged) {
          const parts: string[] = [];
          if (amountChanged) {
            parts.push(`advance ${previousAdvance ?? "?"} → ${finalAdvance}`);
          }
          if (methodChanged) {
            parts.push(`method ${previousAdvanceMethod ?? "?"} → ${finalAdvanceMethod}`);
          }
          await tx.bookingEditHistory.create({
            data: {
              bookingId,
              adminId: admin.id,
              adminUsername: admin.username,
              editType: "ADVANCE_CHANGED",
              previousAmount,
              newAmount: newTotalAmount,
              note: parts.join(" · "),
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
