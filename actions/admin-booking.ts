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

  await db.payment.update({
    where: { id: payment.id },
    data: {
      status: "COMPLETED",
      confirmedBy: adminId,
      confirmedAt: new Date(),
    },
  });

  return { success: true };
}

export async function confirmUpiPayment(bookingId: string) {
  const adminId = await requireAdmin();

  const payment = await db.payment.findUnique({
    where: { bookingId },
  });

  if (!payment || payment.method !== "UPI_QR") {
    return { success: false, error: "UPI payment not found" };
  }

  await db.payment.update({
    where: { id: payment.id },
    data: {
      status: "COMPLETED",
      confirmedBy: adminId,
      confirmedAt: new Date(),
    },
  });

  return { success: true };
}

export async function refundBooking(bookingId: string, reason: string) {
  const adminId = await requireAdmin();

  if (!reason.trim()) {
    return { success: false, error: "Refund reason is required" };
  }

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { payment: true },
  });

  if (!booking) {
    return { success: false, error: "Booking not found" };
  }

  await db.$transaction([
    db.booking.update({
      where: { id: bookingId },
      data: { status: "CANCELLED" },
    }),
    ...(booking.payment
      ? [
          db.payment.update({
            where: { id: booking.payment.id },
            data: {
              status: "REFUNDED",
              refundedBy: adminId,
              refundedAt: new Date(),
              refundReason: reason,
            },
          }),
        ]
      : []),
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
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    db.booking.count({ where }),
  ]);

  return { bookings, total, page, totalPages: Math.ceil(total / limit) };
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
