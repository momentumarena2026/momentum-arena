"use server";

import { after } from "next/server";

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-auth";
import {
  sendBookingConfirmation,
  notifyAdminBookingConfirmed,
} from "@/lib/notifications";
import { releaseCafeCoupon } from "@/lib/cafe-intent";

// Fields releaseCafeCoupon needs off the cancelled order. Selected on the
// payment's `order` relation by both cafe-cancelling paths below.
const CAFE_COUPON_ORDER_SELECT = {
  id: true,
  status: true,
  discountCodeId: true,
  discountAmount: true,
} as const;

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
  paymentId: string
): Promise<{ success: boolean; error?: string }> {
  // The confirming admin is whoever the gate resolves — never a
  // caller-supplied id. requireAdmin accepts the web cookie session or
  // the mobile Bearer JWT, so the mobile route's in-process call is
  // authenticated and stamped correctly too.
  const admin = await requireAdmin("MANAGE_BOOKINGS");

  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: { booking: true },
  });

  if (!payment) {
    return { success: false, error: "Payment not found" };
  }

  if (payment.status !== "PENDING") {
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

  // Send booking confirmation to the customer
  await sendBookingConfirmation(payment.bookingId);
  after(async () => {
    await notifyAdminBookingConfirmed(payment.bookingId).catch((err) =>
      console.error("[notify] admin confirmed failed", err),
    );
  });

  return { success: true };
}

// ─── Admin: verify a cafe UTR payment ───────────────────────

export async function verifyCafeUtr(
  paymentId: string
): Promise<{ success: boolean; error?: string }> {
  // See verifyBookingUtr — confirming admin comes from the gate only.
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
  reason: string,
  type: "booking" | "cafe" = "booking"
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin("MANAGE_BOOKINGS");

  if (type === "cafe") {
    const payment = await db.cafePayment.findUnique({
      where: { id: paymentId },
      include: { order: { select: CAFE_COUPON_ORDER_SELECT } },
    });
    if (!payment) return { success: false, error: "Payment not found" };

    await db.$transaction(async (tx) => {
      await tx.cafePayment.update({
        where: { id: paymentId },
        data: { status: "FAILED" },
      });
      await tx.cafeOrder.update({
        where: { id: payment.orderId },
        data: { status: "CANCELLED" },
      });
      // Rejecting the UTR kills the order, so the coupon has to go back
      // — same release cancelCafeOrder does. Without it the customer's
      // per-user slot stays burned on an order they never got.
      await releaseCafeCoupon(tx, payment.order);
    });
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

  // Inline expiry: auto-expire overdue UTR payments before fetching
  await expireUnverifiedUtrs();

  const bookingPayments = await db.payment.findMany({
    where: {
      method: "UPI_QR",
      status: "PENDING",
    },
    include: {
      booking: {
        include: {
          user: { select: { id: true, name: true, email: true, phone: true } },
          courtConfig: { select: { id: true, label: true, sport: true, size: true } },
          slots: { select: { startHour: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
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
      utrNumber: p.utrNumber ?? null,
      amount: p.amount,
      isPartialPayment: p.isPartialPayment,
      advanceAmount: p.advanceAmount,
      utrSubmittedAt: p.utrSubmittedAt?.toISOString() ?? null,
      utrExpiresAt: p.utrExpiresAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
      booking: {
        id: p.booking.id,
        date: p.booking.date.toISOString(),
        userName: p.booking.user?.name ?? "Unknown",
        userEmail: p.booking.user?.email ?? "",
        userPhone: p.booking.user?.phone ?? "",
        sport: p.booking.courtConfig.sport,
        courtLabel: p.booking.courtConfig.label,
        courtSize: p.booking.courtConfig.size,
        slots: p.booking.slots.map((s: { startHour: number }) => s.startHour),
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
    include: { order: { select: CAFE_COUPON_ORDER_SELECT } },
  });

  for (const payment of expiredCafePayments) {
    await db.$transaction(async (tx) => {
      await tx.cafePayment.update({
        where: { id: payment.id },
        data: { status: "FAILED" },
      });
      await tx.cafeOrder.update({
        where: { id: payment.orderId },
        data: { status: "CANCELLED" },
      });
      // Expiry cancels the order, so the coupon claim goes back too —
      // see the reject path above.
      await releaseCafeCoupon(tx, payment.order);
    });
  }

  return { expiredCount: expiredBookingPayments.length + expiredCafePayments.length };
}
