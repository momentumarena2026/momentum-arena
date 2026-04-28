"use server";

import { db } from "@/lib/db";
import {
  sendBookingConfirmation,
  notifyAdminBookingConfirmed,
} from "@/lib/notifications";
import { requireAdmin as requireAdminBase } from "@/lib/admin-auth";
import { normalizeIndianPhone } from "@/lib/phone";
import { sendToUser } from "@/lib/push";
import { formatHoursAsRanges } from "@/lib/court-config";

async function requireAdmin() {
  const user = await requireAdminBase("MANAGE_BOOKINGS");
  return user.id;
}

/**
 * Bust the App Router cache for every page that renders the booking
 * row(s) we just touched. Web form-action callers used to get this
 * for free (they re-render after the action), but mobile API routes
 * call these functions over JWT and never trigger a re-render — so
 * without this the web admin / customer pages would keep showing the
 * pre-mutation snapshot until the user manually refreshes.
 *
 * Wrapped in try/catch so unit tests / non-Next contexts that import
 * the action don't break.
 */
async function revalidateBookingPaths(bookingId?: string) {
  try {
    const { revalidatePath } = await import("next/cache");
    if (bookingId) revalidatePath(`/admin/bookings/${bookingId}`);
    revalidatePath("/admin/bookings");
    revalidatePath("/admin/bookings/unconfirmed");
    revalidatePath("/admin/calendar");
  } catch {
    /* outside Next.js — fine */
  }
}

// `adminIdOverride` lets the mobile-admin API routes call this action
// after authenticating via JWT (instead of NextAuth web cookie). When
// provided, the regular `requireAdmin()` check is skipped — the
// caller is responsible for ensuring it has already validated an
// AdminUser. Web call sites pass nothing and get the existing
// cookie-based gate.
export async function confirmCashPayment(bookingId: string, adminIdOverride?: string) {
  const adminId = adminIdOverride ?? (await requireAdmin());

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

  await revalidateBookingPaths(bookingId);

  return { success: true };
}

export async function confirmUpiPayment(bookingId: string, adminIdOverride?: string) {
  const adminId = adminIdOverride ?? (await requireAdmin());

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

  await revalidateBookingPaths(bookingId);

  return { success: true };
}

// Describe how the remainder was actually collected at the venue: the
// amount paid in cash, the amount paid via UPI QR, and any goodwill
// discount the floor staff applied at collection time. The three legs
// can be zero individually but their sum must equal the remainder
// owed, and at least one of cash/upi must be > 0 (a "100% discount"
// is technically valid only at booking creation, not at collection).
//
// `discountAmount` is OPTIONAL on the input for backwards compat with
// older call sites; defaulted to 0 internally.
export type RemainderSplit = {
  cashAmount: number;
  upiAmount: number;
  discountAmount?: number;
};

function describeSplit(cash: number, upi: number, discount: number = 0): string {
  const parts: string[] = [];
  if (cash > 0) parts.push(`Rs.${cash} Cash`);
  if (upi > 0) parts.push(`Rs.${upi} UPI QR`);
  if (discount > 0) parts.push(`Rs.${discount} Discount`);
  return parts.length > 0 ? parts.join(" + ") : "no collection";
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
  split: RemainderSplit,
  adminIdOverride?: string
) {
  const adminId = adminIdOverride ?? (await requireAdmin());

  const cashAmount = Math.trunc(split.cashAmount ?? 0);
  const upiAmount = Math.trunc(split.upiAmount ?? 0);
  const discountAmount = Math.trunc(split.discountAmount ?? 0);
  if (cashAmount < 0 || upiAmount < 0 || discountAmount < 0) {
    return { success: false, error: "Amounts cannot be negative" };
  }
  // At least one of cash/UPI must be > 0 — a 100%-discount collection
  // would zero out Payment.amount, which is a refund-shaped operation,
  // not a "remainder collected" one.
  if (cashAmount === 0 && upiAmount === 0) {
    return { success: false, error: "Enter at least one collected amount" };
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
  // Use Payment.remainingAmount only as the "still owed?" gate — the
  // amount to charge at the venue is derived from totalAmount - advance
  // so historical rows where remainingAmount was stored pre-discount
  // (coupon bug) still validate against the correct post-discount figure.
  const storedRemaining = booking.payment.remainingAmount ?? 0;
  if (storedRemaining <= 0) {
    return { success: false, error: "Remainder already collected" };
  }
  const advance = booking.payment.advanceAmount ?? 0;
  const remaining = Math.max(booking.totalAmount - advance, 0);
  if (remaining <= 0) {
    return { success: false, error: "Remainder already collected" };
  }
  // Cash + UPI + Discount must equal the remainder. The discount slice
  // is what the venue absorbs; it doesn't increase Payment.amount.
  if (cashAmount + upiAmount + discountAmount !== remaining) {
    return {
      success: false,
      error: `Cash + UPI + Discount must total Rs.${remaining} (got Rs.${
        cashAmount + upiAmount + discountAmount
      })`,
    };
  }

  const admin = await db.adminUser.findUnique({ where: { id: adminId } });
  const adminUsername = admin?.username ?? "unknown";

  // `remainderMethod` keeps the legacy single-method label only when the
  // collection was a single non-discount method. Anything mixed (or any
  // discount applied) leaves it null and lets the display layer fall
  // back to the per-leg amounts.
  const singleMethod =
    discountAmount === 0 && cashAmount > 0 && upiAmount === 0
      ? "CASH"
      : discountAmount === 0 && upiAmount > 0 && cashAmount === 0
      ? "UPI_QR"
      : null;

  // Only cash + UPI count as "actually collected" — the discount slice
  // is not added to Payment.amount. remainingAmount drops to 0 because
  // nothing more is owed (the venue absorbed the discount portion).
  const collectedAtVenue = cashAmount + upiAmount;

  // The at-collection discount also lowers the booking's effective
  // total cost: a customer charged ₹2000 but given an ₹800 goodwill
  // cut paid ₹1200 — so the "Amount" field on the detail page should
  // read ₹1200, not ₹2000. We mirror the discount onto Booking.
  // discountAmount (alongside any pre-existing coupon discount) and
  // re-derive originalAmount so the strike-through "₹X" pill stays
  // accurate. Skip the booking write when discountAmount is 0 to
  // avoid touching the row unnecessarily.
  const newBookingTotal = booking.totalAmount - discountAmount;
  const newBookingDiscount = booking.discountAmount + discountAmount;
  const newBookingOriginal =
    newBookingDiscount > 0 ? newBookingTotal + newBookingDiscount : null;

  await db.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: booking.payment!.id },
      data: {
        amount: booking.payment!.amount + collectedAtVenue,
        remainingAmount: 0,
        remainderMethod: singleMethod,
        remainderCashAmount: cashAmount,
        remainderUpiAmount: upiAmount,
        remainderDiscountAmount: discountAmount > 0 ? discountAmount : null,
        // PARTIAL -> COMPLETED now that the venue collection has been
        // recorded. Idempotent: if a prior state was already COMPLETED
        // (legacy rows), this is a no-op write.
        status: "COMPLETED",
      },
    });
    await tx.bookingEditHistory.create({
      data: {
        bookingId,
        adminId,
        adminUsername,
        editType: "REMAINDER_COLLECTED",
        note: `Collected remaining Rs.${remaining} at venue: ${describeSplit(
          cashAmount,
          upiAmount,
          discountAmount,
        )}`,
      },
    });
    if (discountAmount > 0) {
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          totalAmount: newBookingTotal,
          discountAmount: newBookingDiscount,
          originalAmount: newBookingOriginal,
        },
      });
    }
  });

  return { success: true };
}

// Edit the cash/UPI/discount split on a partial-payment booking whose
// remainder has already been collected. Re-attributes the same
// venue-side total across the three legs to fix entry mistakes after
// the fact. Updates Payment.amount when the discount portion changes
// (since cash + UPI is what counts as "actually collected"), keeps
// remainingAmount / status at COMPLETED, and writes an audit row with
// the before/after values.
export async function updateRemainderSplit(
  bookingId: string,
  split: RemainderSplit,
  adminIdOverride?: string
) {
  const adminId = adminIdOverride ?? (await requireAdmin());

  const cashAmount = Math.trunc(split.cashAmount ?? 0);
  const upiAmount = Math.trunc(split.upiAmount ?? 0);
  const discountAmount = Math.trunc(split.discountAmount ?? 0);
  if (cashAmount < 0 || upiAmount < 0 || discountAmount < 0) {
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
  if (cashAmount + upiAmount + discountAmount !== venueTotal) {
    return {
      success: false,
      error: `Cash + UPI + Discount must total Rs.${venueTotal} (got Rs.${
        cashAmount + upiAmount + discountAmount
      })`,
    };
  }
  if (cashAmount === 0 && upiAmount === 0) {
    return { success: false, error: "Enter at least one collected amount" };
  }

  const priorCash =
    booking.payment.remainderCashAmount ??
    (booking.payment.remainderMethod === "CASH" ? venueTotal : 0);
  const priorUpi =
    booking.payment.remainderUpiAmount ??
    (booking.payment.remainderMethod === "UPI_QR" ? venueTotal : 0);
  const priorDiscount = booking.payment.remainderDiscountAmount ?? 0;
  if (
    priorCash === cashAmount &&
    priorUpi === upiAmount &&
    priorDiscount === discountAmount
  ) {
    return { success: false, error: "No changes to save" };
  }

  const admin = await db.adminUser.findUnique({ where: { id: adminId } });
  const adminUsername = admin?.username ?? "unknown";

  const singleMethod =
    discountAmount === 0 && cashAmount > 0 && upiAmount === 0
      ? "CASH"
      : discountAmount === 0 && upiAmount > 0 && cashAmount === 0
      ? "UPI_QR"
      : null;

  // The actually-collected total (cash + UPI) drives Payment.amount. We
  // adjust by the delta vs the prior cash+UPI so this stays correct
  // when the discount slice grows or shrinks.
  const newCollected = cashAmount + upiAmount;
  const priorCollected = priorCash + priorUpi;
  const delta = newCollected - priorCollected;

  // The booking-level total/discount also need to slide by the inverse
  // of the at-collection discount delta. Growing the discount portion
  // lowers Booking.totalAmount (the venue absorbed more); shrinking it
  // raises Booking.totalAmount. Coupon discounts that were already on
  // the booking row stay folded into the running discountAmount.
  const discountDelta = discountAmount - priorDiscount;
  const newBookingTotal = booking.totalAmount - discountDelta;
  const newBookingDiscount = booking.discountAmount + discountDelta;
  // Invariant: originalAmount = totalAmount + discountAmount when a
  // discount applies; null when no discount. Re-derive from the new
  // figures rather than preserving the old originalAmount, so dropping
  // the discount to zero clears the strike-through pill correctly.
  const newBookingOriginal =
    newBookingDiscount > 0 ? newBookingTotal + newBookingDiscount : null;

  await db.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: booking.payment!.id },
      data: {
        ...(delta !== 0
          ? { amount: booking.payment!.amount + delta }
          : {}),
        remainderMethod: singleMethod,
        remainderCashAmount: cashAmount,
        remainderUpiAmount: upiAmount,
        remainderDiscountAmount: discountAmount > 0 ? discountAmount : null,
      },
    });
    await tx.bookingEditHistory.create({
      data: {
        bookingId,
        adminId,
        adminUsername,
        editType: "REMAINDER_SPLIT_EDITED",
        note: `Updated venue collection split from ${describeSplit(
          priorCash,
          priorUpi,
          priorDiscount,
        )} to ${describeSplit(cashAmount, upiAmount, discountAmount)}`,
      },
    });
    if (discountDelta !== 0) {
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          totalAmount: newBookingTotal,
          discountAmount: newBookingDiscount,
          originalAmount: newBookingOriginal,
        },
      });
    }
  });

  return { success: true };
}

export async function cancelBooking(
  bookingId: string,
  reason: string,
  adminIdOverride?: string
) {
  const adminId = adminIdOverride ?? (await requireAdmin());

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

  await revalidateBookingPaths(bookingId);

  // Push notification to the customer. Best-effort — fire-and-forget so
  // the admin's confirmation roundtrip stays fast and a flaky FCM call
  // doesn't surface as a UI error on a successful cancellation.
  void notifyBookingCancelled(bookingId, reason);

  return { success: true };
}

// Helper used by both cancelBooking and refundBooking. Only the title
// differs ("cancelled" vs "refunded") — everything else is identical so
// the customer sees a consistent notification.
async function notifyBookingCancelled(
  bookingId: string,
  reason: string,
  refunded: boolean = false,
): Promise<void> {
  try {
    const b = await db.booking.findUnique({
      where: { id: bookingId },
      select: {
        userId: true,
        date: true,
        slots: { orderBy: { startHour: "asc" }, select: { startHour: true } },
      },
    });
    if (!b) return;
    const dateLabel = b.date.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      timeZone: "Asia/Kolkata",
    });
    const timeLabel =
      b.slots.length > 0
        ? formatHoursAsRanges(b.slots.map((s) => s.startHour))
        : "";
    const when = [dateLabel, timeLabel].filter(Boolean).join(" ");
    await sendToUser(b.userId, {
      title: refunded ? "Booking refunded" : "Booking cancelled",
      body: when
        ? `Your slot on ${when} was ${refunded ? "refunded" : "cancelled"}.${
            reason ? ` Reason: ${reason.slice(0, 120)}` : ""
          }`
        : reason
          ? `Reason: ${reason.slice(0, 200)}`
          : refunded
            ? "Your refund has been processed."
            : "Your booking was cancelled.",
      data: {
        kind: refunded ? "refund_processed" : "booking_cancelled",
        bookingId,
      },
    });
  } catch (err) {
    console.error("Cancellation push failed for", bookingId, err);
  }
}

export async function refundBooking(
  bookingId: string,
  reason: string,
  refundMethod?: "ORIGINAL" | "CASH" | "UPI" | "BANK_TRANSFER",
  refundAmount?: number,
  adminIdOverride?: string
) {
  const adminId = adminIdOverride ?? (await requireAdmin());

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

  // Same lock-screen notification as plain cancellation, but with the
  // refunded copy + the refund_processed kind so analytics can split
  // the two outcomes downstream.
  void notifyBookingCancelled(bookingId, reason, true);

  return { success: true };
}

export async function getAdminBookings(filters?: {
  date?: string;
  sport?: string;
  status?: string;
  paymentMethod?: string;
  platform?: string;
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
  if (filters?.platform) {
    where.platform = filters.platform;
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
    lifetimeEarnings,
    firstBooking,
  ] = await Promise.all([
    db.booking.count({ where: { status: "CONFIRMED" } }),
    db.booking.count({
      where: { date: today, status: "CONFIRMED" },
    }),
    db.user.count({ where: { deletedAt: null } }),
    // Revenue is summed from Booking.totalAmount (post-discount) rather
    // than Payment.amount. Payment.amount stores what the gateway charged,
    // which for a handful of discount-applied bookings diverged from the
    // actually-owed total (pre-discount payments where only Booking.total
    // got reduced). Booking.totalAmount is authoritatively the final
    // figure, so it reconciles today's revenue (e.g. ₹6,100 with a ₹100
    // coupon) regardless of how the discount flow wrote the Payment row.
    //
    // Scoped to COMPLETED payments (excludes PARTIAL advances still owed
    // at venue) + CONFIRMED bookings (drops cancellations). Date filter
    // goes on payment.confirmedAt so "today's revenue" means "money
    // recognized today".
    db.booking.aggregate({
      where: {
        status: "CONFIRMED",
        payment: {
          status: "COMPLETED",
          confirmedAt: { gte: today, lt: tomorrow },
        },
      },
      _sum: { totalAmount: true },
    }),
    db.booking.aggregate({
      where: {
        status: "CONFIRMED",
        payment: { status: "COMPLETED" },
      },
      _sum: { totalAmount: true },
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
    // Lifetime earnings for the "avg per day" tile — pre-discount, so
    // coupon marketing spend doesn't drag the headline number down.
    // Kept separate from totalRevenue above (which is post-discount
    // recognized money) because the tile's intent is "how much did our
    // sports operation gross on a typical day".
    db.booking.aggregate({
      where: { status: "CONFIRMED" },
      _sum: { totalAmount: true, originalAmount: true, discountAmount: true },
    }),
    // Earliest Booking.date seeds the denominator for the daily
    // average. Using Booking.date (not createdAt) so a retroactively
    // logged historical booking stretches the denominator correctly.
    db.booking.findFirst({
      where: { status: "CONFIRMED" },
      orderBy: { date: "asc" },
      select: { date: true },
    }),
  ]);

  // Gross (pre-discount) earnings = sum(totalAmount) + sum(discountAmount).
  // Booking.originalAmount is only populated when a discount was applied,
  // so we can't just sum it; reconstructing from totalAmount + discount
  // avoids missing the unrelieved-by-discount bookings.
  const grossEarnings =
    (lifetimeEarnings._sum.totalAmount ?? 0) +
    (lifetimeEarnings._sum.discountAmount ?? 0);

  let averageDailyEarning = 0;
  if (firstBooking?.date && grossEarnings > 0) {
    // Inclusive day count: if first booking is today, that's 1 day, not 0.
    const firstDayUtc = Date.UTC(
      firstBooking.date.getUTCFullYear(),
      firstBooking.date.getUTCMonth(),
      firstBooking.date.getUTCDate()
    );
    const todayUtc = Date.UTC(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );
    const days = Math.max(
      1,
      Math.floor((todayUtc - firstDayUtc) / 86_400_000) + 1
    );
    averageDailyEarning = Math.round(grossEarnings / days);
  }

  return {
    totalBookings,
    todayBookings,
    totalUsers,
    todayRevenue: todayRevenue._sum.totalAmount ?? 0,
    totalRevenue: totalRevenue._sum.totalAmount ?? 0,
    pendingPayments,
    venueDueTotal: venueDueAgg._sum.remainingAmount ?? 0,
    averageDailyEarning,
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
  excludeBookingId?: string,
  skipAuth?: boolean
) {
  if (!skipAuth) await requireAdmin();

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
      if (data.advanceAmount < 0) {
        return { success: false as const, error: "Advance amount cannot be negative" };
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
    // An explicitly-provided 0 is treated as a partial payment (admin
    // is booking without collecting any money upfront) — we distinguish
    // "advance not provided" (undefined) from "0 provided" (explicit zero).
    const advanceProvided = data.advanceAmount !== undefined;
    const rawAdvance = data.advanceAmount ?? 0;
    const isPartial = advanceProvided && rawAdvance < totalAmount;
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
  newDate?: string,
  adminOverride?: { id: string; username: string }
) {
  const admin = adminOverride ?? (await requireAdminWithDetails());

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
    const newPreDiscountTotal = newHours.reduce(
      (sum, h) => sum + (priceMap.get(h) ?? 0),
      0,
    );

    // Carry the booking-level discount through, same as
    // adminEditBookingFull. Without this a slot-only edit silently
    // drops a coupon: e.g. trimming one hour off a FLAT100 booking
    // would charge the customer the full new slot total instead of
    // (new total − ₹100).
    let newDiscountAmount = 0;
    if (booking.discountAmount > 0) {
      if (booking.discountCodeId) {
        const code = await db.discountCode.findUnique({
          where: { id: booking.discountCodeId },
          select: { type: true, value: true },
        });
        if (code?.type === "PERCENTAGE") {
          // value is basis points (10000 = 100%) — matches the
          // computation in discount-validation.ts.
          newDiscountAmount = Math.floor(
            (newPreDiscountTotal * code.value) / 10000,
          );
        } else {
          newDiscountAmount = booking.discountAmount;
        }
      } else {
        newDiscountAmount = booking.discountAmount;
      }
      newDiscountAmount = Math.min(newDiscountAmount, newPreDiscountTotal);
    }

    const newTotalAmount = Math.max(
      newPreDiscountTotal - newDiscountAmount,
      0,
    );
    const newOriginalAmount =
      newDiscountAmount > 0 ? newPreDiscountTotal : null;

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

      // Update booking total + discount fields and (if the admin moved
      // it) the date. originalAmount/discountAmount are rewritten so a
      // partial-court customer who edits down doesn't see a stale
      // strike-through pill referencing the old slot configuration.
      const bookingPatch: {
        totalAmount: number;
        originalAmount: number | null;
        discountAmount: number;
        date?: Date;
      } = {
        totalAmount: newTotalAmount,
        originalAmount: newOriginalAmount,
        discountAmount: newDiscountAmount,
      };
      if (dateChanged) bookingPatch.date = dateOnly;
      await tx.booking.update({
        where: { id: bookingId },
        data: bookingPatch,
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
  },
  adminOverride?: { id: string; username: string }
) {
  const admin = adminOverride ?? (await requireAdminWithDetails());

  try {
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      include: { slots: true, courtConfig: true, payment: true },
    });

    if (!booking) return { success: false as const, error: "Booking not found" };
    if (booking.status !== "CONFIRMED") {
      return { success: false as const, error: "Only confirmed bookings can be edited" };
    }
    // Customer-created bookings paid via gateway are now editable too
    // (e.g. customer asks to switch from full court to half) — see the
    // payment-amount branch below for how we keep the captured-amount
    // record intact while still letting the booking total change.

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
    const newPreDiscountTotal = finalHours.reduce(
      (sum, h) => sum + (priceMap.get(h) ?? 0),
      0,
    );

    // Carry the existing booking-level discount through to the new
    // total. Without this step, switching from full → half court drops
    // the customer's coupon discount on the floor: e.g. a ₹2000 booking
    // with FLAT100 (₹1900 charged) edited to a ₹1200 half court would
    // bill the customer ₹1200 instead of the correct ₹1100.
    //
    // We recompute against the new pre-discount total so PERCENTAGE
    // coupons stay proportional, and preserve the absolute amount for
    // FLAT coupons (and admin-applied custom discounts where
    // discountCodeId is null). The discount is always capped at the
    // new pre-discount total to avoid negative totals on shrinkage.
    let newDiscountAmount = 0;
    if (booking.discountAmount > 0) {
      if (booking.discountCodeId) {
        const code = await db.discountCode.findUnique({
          where: { id: booking.discountCodeId },
          select: { type: true, value: true },
        });
        if (code?.type === "PERCENTAGE") {
          // value is basis points (10000 = 100%), matching how
          // discount-validation.ts computes it at booking time.
          newDiscountAmount = Math.floor(
            (newPreDiscountTotal * code.value) / 10000,
          );
        } else {
          // FLAT (or coupon row deleted): preserve the absolute amount.
          newDiscountAmount = booking.discountAmount;
        }
      } else {
        // No coupon row — treat as a pre-existing flat admin discount.
        newDiscountAmount = booking.discountAmount;
      }
      newDiscountAmount = Math.min(newDiscountAmount, newPreDiscountTotal);
    }

    const newTotalAmount = Math.max(
      newPreDiscountTotal - newDiscountAmount,
      0,
    );
    // originalAmount tracks the pre-discount slot total whenever a
    // discount is applied, so the UI can render the strike-through
    // "₹X" alongside the actual charge. Null it out if the new total
    // is undiscounted (e.g. a FLAT coupon was capped to zero by a
    // tiny new total).
    const newOriginalAmount = newDiscountAmount > 0 ? newPreDiscountTotal : null;

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
      // 0 is a valid advance — admin uses it to mark a booking as
      // "no advance, collect everything at venue" while keeping the
      // payment record intact. Mirrors the create flow's validation
      // (createAdminBooking allows advanceAmount === 0). Reject only
      // null / non-integer / negative.
      if (finalAdvance === null || !Number.isInteger(finalAdvance) || finalAdvance < 0) {
        return { success: false as const, error: "Advance must be a non-negative integer" };
      }
      if (finalAdvance >= newTotalAmount) {
        return { success: false as const, error: "Advance must be less than the total amount" };
      }
    }

    await db.$transaction(async (tx) => {
      // Update booking. We rewrite originalAmount alongside totalAmount
      // because the previous originalAmount referred to the OLD slot
      // configuration (e.g. ₹2000 full court); after a court swap that
      // figure is misleading. Setting it from `newOriginalAmount`
      // keeps the strike-through "₹X" pill in the UI accurate, or
      // clears it when no discount applies post-edit.
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          date: finalDate,
          courtConfigId: finalCourtConfigId,
          totalAmount: newTotalAmount,
          originalAmount: newOriginalAmount,
          discountAmount: newDiscountAmount,
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
      //
      // Three cases:
      //
      //  1. Partial-payment edit (admin tweaks advance / method).
      //     Keep `amount` synced with advanceAmount as today.
      //
      //  2. Admin-created cash booking that's been edited.
      //     Payment.amount tracks "what was collected", admin can
      //     adjust freely → overwrite with the new total. Same as
      //     the previous behavior.
      //
      //  3. Customer booking paid via gateway (Razorpay / PhonePe /
      //     UPI QR / FREE), now being edited.
      //     Payment.amount is the captured amount on the gateway side
      //     (or the recorded UTR / coupon-zero) — overwriting it
      //     would lose the audit trail. Leave Payment.amount alone;
      //     Booking.totalAmount carries the new value, and the UI
      //     shows the delta as either "refund due to customer" or
      //     "collect ₹X extra at venue". If the new total exceeds the
      //     captured amount, flip the payment to PARTIAL with the
      //     remainder so existing partial-payment UX kicks in.
      if (booking.payment) {
        const paymentUpdate: {
          amount?: number;
          advanceAmount?: number;
          remainingAmount?: number;
          method?: "CASH" | "UPI_QR";
          isPartialPayment?: boolean;
        } = {};

        if (booking.payment.isPartialPayment && finalAdvance !== null) {
          paymentUpdate.amount = finalAdvance;
          paymentUpdate.advanceAmount = finalAdvance;
          paymentUpdate.remainingAmount = newTotalAmount - finalAdvance;
        } else if (booking.createdByAdminId) {
          // Admin-created cash flow — case (2).
          paymentUpdate.amount = newTotalAmount;
        } else {
          // Case (3): customer paid via gateway. Don't touch
          // Payment.amount. If the booking just got more expensive,
          // flip to PARTIAL so "Collect ₹X at venue" surfaces.
          const captured = booking.payment.amount;
          if (newTotalAmount > captured) {
            paymentUpdate.isPartialPayment = true;
            paymentUpdate.advanceAmount = captured;
            paymentUpdate.remainingAmount = newTotalAmount - captured;
          }
          // If newTotal <= captured, leave Payment as-is. UI shows
          // a "Refund ₹delta due" pill that admin reconciles via the
          // gateway dashboard (or refundBooking later).
        }

        if (data.newAdvanceMethod) {
          paymentUpdate.method = data.newAdvanceMethod;
        }

        if (Object.keys(paymentUpdate).length > 0) {
          await tx.payment.update({
            where: { id: booking.payment.id },
            data: paymentUpdate,
          });
        }
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
