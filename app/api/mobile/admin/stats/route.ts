import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMobileAdmin } from "@/lib/mobile-auth";

/**
 * GET /api/mobile/admin/stats — dashboard KPIs for the mobile admin Home.
 *
 * Mirrors the core of `getAdminStats` (actions/admin-booking.ts) but reads the
 * bearer-token admin instead of the NextAuth web session. Viewable by any
 * admin (no specific permission, like the web). Revenue is summed from
 * Booking.totalAmount (post-discount, authoritative) scoped to non-cancelled
 * bookings + COMPLETED payments — same reconciliation the web dashboard uses.
 */

// Local copy of getAdminStats' EARNING_BOOKING_STATUSES. It can't be
// imported: actions/admin-booking.ts is a "use server" module, so every
// export there has to be an async function. Keep the two in step — a
// booking that stood still earned, so the front desk's closeout buttons
// (COMPLETED / ABSENT) must not delete it from these KPIs. Only
// CANCELLED is out. What keeps ABSENT honest is closeOutBooking writing
// the uncollected balance off Booking.totalAmount.
const EARNING_BOOKING_STATUSES = ["CONFIRMED", "COMPLETED", "ABSENT"] as const;

export async function GET(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [
    totalBookings,
    todayBookings,
    totalUsers,
    todayEarningAgg,
    totalEarningAgg,
    pendingPayments,
    venueDueAgg,
  ] = await Promise.all([
    db.booking.count({
      where: { status: { in: [...EARNING_BOOKING_STATUSES] } },
    }),
    db.booking.count({
      where: { date: today, status: { in: [...EARNING_BOOKING_STATUSES] } },
    }),
    db.user.count({ where: { deletedAt: null } }),
    db.booking.aggregate({
      where: {
        status: { in: [...EARNING_BOOKING_STATUSES] },
        payment: {
          status: "COMPLETED",
          confirmedAt: { gte: today, lt: tomorrow },
        },
      },
      _sum: { totalAmount: true },
    }),
    db.booking.aggregate({
      where: {
        status: { in: [...EARNING_BOOKING_STATUSES] },
        payment: { status: "COMPLETED", confirmedAt: { not: null } },
      },
      _sum: { totalAmount: true },
    }),
    db.payment.count({ where: { status: "PENDING" } }),
    // Cash still owed at the venue. Deliberately stays CONFIRMED-only
    // while the tiles above widened: once a booking is closed out the
    // remainder has been collected or forfeited, so nothing is due.
    db.payment.aggregate({
      where: {
        isPartialPayment: true,
        remainingAmount: { gt: 0 },
        booking: { status: "CONFIRMED" },
      },
      _sum: { remainingAmount: true },
    }),
  ]);

  return NextResponse.json({
    stats: {
      totalBookings,
      todayBookings,
      totalUsers,
      todayEarning: todayEarningAgg._sum.totalAmount ?? 0,
      totalEarning: totalEarningAgg._sum.totalAmount ?? 0,
      pendingPayments,
      venueDueTotal: venueDueAgg._sum.remainingAmount ?? 0,
    },
  });
}
