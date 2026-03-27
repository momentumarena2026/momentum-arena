"use server";

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-auth";

// ─── Helpers ────────────────────────────────────────────────

function isValidUtr(utr: string): boolean {
  const trimmed = utr.trim();
  if (trimmed.length < 10 || trimmed.length > 22) return false;
  return /^[a-zA-Z0-9]+$/.test(trimmed);
}

// ─── Submit UTR for a sports booking payment ────────────────

export async function submitBookingUtr(
  bookingId: string,
  utrNumber: string
): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  const trimmedUtr = utrNumber.trim();
  if (!isValidUtr(trimmedUtr)) {
    return { success: false, error: "Invalid UTR format. Must be 10-22 alphanumeric characters." };
  }

  const payment = await db.payment.findFirst({
    where: { bookingId, booking: { userId: session.user.id } },
  });

  if (!payment) {
    return { success: false, error: "Payment not found" };
  }

  if (payment.method !== "UPI_QR") {
    return { success: false, error: "Payment method is not UPI QR" };
  }

  if (payment.status !== "PENDING") {
    return { success: false, error: "Payment is no longer pending" };
  }

  // Check UTR uniqueness across both payment tables
  const existingPayment = await db.payment.findFirst({
    where: { utrNumber: trimmedUtr, id: { not: payment.id } },
  });
  const existingCafePayment = await db.cafePayment.findFirst({
    where: { utrNumber: trimmedUtr },
  });

  if (existingPayment || existingCafePayment) {
    return { success: false, error: "This UTR has already been used for another payment" };
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);

  await db.payment.update({
    where: { id: payment.id },
    data: {
      utrNumber: trimmedUtr,
      utrSubmittedAt: now,
      utrExpiresAt: expiresAt,
    },
  });

  return { success: true };
}

// ─── Submit UTR for a cafe order payment ────────────────────

export async function submitCafeOrderUtr(
  orderId: string,
  utrNumber: string
): Promise<{ success: boolean; error?: string }> {
  const trimmedUtr = utrNumber.trim();
  if (!isValidUtr(trimmedUtr)) {
    return { success: false, error: "Invalid UTR format. Must be 10-22 alphanumeric characters." };
  }

  const payment = await db.cafePayment.findFirst({
    where: { orderId },
    include: { order: { select: { userId: true } } },
  });

  if (!payment) {
    return { success: false, error: "Payment not found" };
  }

  // Verify ownership: if order has a userId, the caller must match
  // Guest orders (userId is null) can be submitted by anyone with the orderId
  if (payment.order.userId) {
    const { auth } = await import("@/lib/auth");
    const session = await auth();
    if (!session?.user?.id || session.user.id !== payment.order.userId) {
      return { success: false, error: "Unauthorized" };
    }
  }

  if (payment.method !== "UPI_QR") {
    return { success: false, error: "Payment method is not UPI QR" };
  }

  if (payment.status !== "PENDING") {
    return { success: false, error: "Payment is no longer pending" };
  }

  // Check UTR uniqueness
  const existingPayment = await db.payment.findFirst({
    where: { utrNumber: trimmedUtr },
  });
  const existingCafePayment = await db.cafePayment.findFirst({
    where: { utrNumber: trimmedUtr, id: { not: payment.id } },
  });

  if (existingPayment || existingCafePayment) {
    return { success: false, error: "This UTR has already been used for another payment" };
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);

  await db.cafePayment.update({
    where: { id: payment.id },
    data: {
      utrNumber: trimmedUtr,
      utrSubmittedAt: now,
      utrExpiresAt: expiresAt,
    },
  });

  return { success: true };
}

// ─── Admin: verify a booking UTR payment ────────────────────

export async function verifyBookingUtr(
  paymentId: string,
  adminId: string
): Promise<{ success: boolean; error?: string }> {
  const admin = await requireAdmin("MANAGE_BOOKINGS");

  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: { booking: true },
  });

  if (!payment) {
    return { success: false, error: "Payment not found" };
  }

  if (payment.status !== "PENDING" || !payment.utrNumber) {
    return { success: false, error: "Payment cannot be verified" };
  }

  const now = new Date();

  await db.$transaction([
    db.payment.update({
      where: { id: paymentId },
      data: {
        status: "COMPLETED",
        utrVerifiedAt: now,
        confirmedBy: admin.id,
        confirmedAt: now,
      },
    }),
    db.booking.update({
      where: { id: payment.bookingId },
      data: { status: "CONFIRMED" },
    }),
  ]);

  return { success: true };
}

// ─── Admin: verify a cafe UTR payment ───────────────────────

export async function verifyCafeUtr(
  paymentId: string,
  adminId: string
): Promise<{ success: boolean; error?: string }> {
  const admin = await requireAdmin("MANAGE_CAFE_ORDERS");

  const payment = await db.cafePayment.findUnique({
    where: { id: paymentId },
    include: { order: true },
  });

  if (!payment) {
    return { success: false, error: "Payment not found" };
  }

  if (payment.status !== "PENDING" || !payment.utrNumber) {
    return { success: false, error: "Payment cannot be verified" };
  }

  const now = new Date();

  await db.$transaction([
    db.cafePayment.update({
      where: { id: paymentId },
      data: {
        status: "COMPLETED",
        utrVerifiedAt: now,
        confirmedBy: admin.id,
        confirmedAt: now,
      },
    }),
    db.cafeOrder.update({
      where: { id: payment.orderId },
      data: { status: "PREPARING" },
    }),
  ]);

  return { success: true };
}

// ─── Admin: reject a UTR payment ────────────────────────────

export async function rejectUtr(
  paymentId: string,
  adminId: string,
  reason: string,
  type: "booking" | "cafe" = "booking"
): Promise<{ success: boolean; error?: string }> {
  const admin = await requireAdmin("MANAGE_BOOKINGS");

  if (type === "cafe") {
    const payment = await db.cafePayment.findUnique({
      where: { id: paymentId },
    });
    if (!payment) return { success: false, error: "Payment not found" };

    await db.$transaction([
      db.cafePayment.update({
        where: { id: paymentId },
        data: { status: "FAILED" },
      }),
      db.cafeOrder.update({
        where: { id: payment.orderId },
        data: { status: "CANCELLED" },
      }),
    ]);
  } else {
    const payment = await db.payment.findUnique({
      where: { id: paymentId },
    });
    if (!payment) return { success: false, error: "Payment not found" };

    await db.$transaction([
      db.payment.update({
        where: { id: paymentId },
        data: { status: "FAILED" },
      }),
      db.booking.update({
        where: { id: payment.bookingId },
        data: { status: "CANCELLED" },
      }),
    ]);
  }

  return { success: true };
}

// ─── Admin: get all pending UTR verifications ───────────────

export async function getPendingUtrPayments() {
  await requireAdmin("MANAGE_BOOKINGS");

  const bookingPayments = await db.payment.findMany({
    where: {
      method: "UPI_QR",
      status: "PENDING",
      utrNumber: { not: null },
    },
    include: {
      booking: {
        include: {
          user: { select: { id: true, name: true, email: true, phone: true } },
          courtConfig: { select: { id: true, name: true, sport: true } },
          slots: { select: { hour: true } },
        },
      },
    },
    orderBy: { utrSubmittedAt: "desc" },
  });

  const cafePayments = await db.cafePayment.findMany({
    where: {
      method: "UPI_QR",
      status: "PENDING",
      utrNumber: { not: null },
    },
    include: {
      order: {
        include: {
          user: { select: { id: true, name: true, email: true, phone: true } },
          items: {
            include: {
              cafeItem: { select: { name: true, price: true } },
            },
          },
        },
      },
    },
    orderBy: { utrSubmittedAt: "desc" },
  });

  // Get today's stats
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [verifiedToday, rejectedToday] = await Promise.all([
    db.payment.count({
      where: {
        method: "UPI_QR",
        status: "COMPLETED",
        utrVerifiedAt: { gte: todayStart },
      },
    }),
    db.payment.count({
      where: {
        method: "UPI_QR",
        status: "FAILED",
        updatedAt: { gte: todayStart },
      },
    }),
  ]);

  return {
    bookingPayments: bookingPayments.map((p) => ({
      id: p.id,
      utrNumber: p.utrNumber!,
      amount: p.amount,
      isPartialPayment: p.isPartialPayment,
      advanceAmount: p.advanceAmount,
      utrSubmittedAt: p.utrSubmittedAt?.toISOString() ?? null,
      utrExpiresAt: p.utrExpiresAt?.toISOString() ?? null,
      booking: {
        id: p.booking.id,
        date: p.booking.date.toISOString(),
        userName: p.booking.user.name ?? "Unknown",
        userEmail: p.booking.user.email ?? "",
        userPhone: p.booking.user.phone ?? "",
        sport: p.booking.courtConfig.sport,
        courtName: p.booking.courtConfig.name,
        slots: p.booking.slots.map((s) => s.hour),
      },
    })),
    cafePayments: cafePayments.map((p) => ({
      id: p.id,
      utrNumber: p.utrNumber!,
      amount: p.amount,
      utrSubmittedAt: p.utrSubmittedAt?.toISOString() ?? null,
      utrExpiresAt: p.utrExpiresAt?.toISOString() ?? null,
      order: {
        id: p.order.id,
        orderNumber: p.order.orderNumber,
        guestName: p.order.guestName,
        guestPhone: p.order.guestPhone,
        userName: p.order.user?.name ?? p.order.guestName ?? "Guest",
        userEmail: p.order.user?.email ?? "",
        userPhone: p.order.user?.phone ?? p.order.guestPhone ?? "",
        items: p.order.items.map((i) => ({
          name: i.cafeItem.name,
          quantity: i.quantity,
          price: i.cafeItem.price,
        })),
      },
    })),
    stats: {
      totalPending: bookingPayments.length + cafePayments.length,
      verifiedToday,
      rejectedToday,
    },
  };
}

// ─── Cron: expire unverified UTR payments ───────────────────

export async function expireUnverifiedUtrs(): Promise<{ expiredCount: number }> {
  const now = new Date();

  // Expire booking payments
  const expiredBookingPayments = await db.payment.findMany({
    where: {
      method: "UPI_QR",
      status: "PENDING",
      utrExpiresAt: { lt: now },
      utrNumber: { not: null },
    },
  });

  for (const payment of expiredBookingPayments) {
    await db.$transaction([
      db.payment.update({
        where: { id: payment.id },
        data: { status: "FAILED" },
      }),
      db.booking.update({
        where: { id: payment.bookingId },
        data: { status: "CANCELLED" },
      }),
    ]);
  }

  // Expire cafe payments
  const expiredCafePayments = await db.cafePayment.findMany({
    where: {
      method: "UPI_QR",
      status: "PENDING",
      utrExpiresAt: { lt: now },
      utrNumber: { not: null },
    },
  });

  for (const payment of expiredCafePayments) {
    await db.$transaction([
      db.cafePayment.update({
        where: { id: payment.id },
        data: { status: "FAILED" },
      }),
      db.cafeOrder.update({
        where: { id: payment.orderId },
        data: { status: "CANCELLED" },
      }),
    ]);
  }

  return { expiredCount: expiredBookingPayments.length + expiredCafePayments.length };
}
