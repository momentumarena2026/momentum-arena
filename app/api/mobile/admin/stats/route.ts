import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMobileAdmin } from "@/lib/mobile-auth";

/**
 * GET /api/mobile/admin/stats — dashboard KPIs for the mobile admin Home.
 *
 * Mirrors the core of `getAdminStats` (actions/admin-booking.ts) but reads the
 * bearer-token admin instead of the NextAuth web session. Viewable by any
 * admin (no specific permission, like the web). Revenue is summed from
 * Booking.totalAmount (post-discount, authoritative) scoped to CONFIRMED
 * bookings + COMPLETED payments — same reconciliation the web dashboard uses.
 */
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
    db.booking.count({ where: { status: "CONFIRMED" } }),
    db.booking.count({ where: { date: today, status: "CONFIRMED" } }),
    db.user.count({ where: { deletedAt: null } }),
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
        payment: { status: "COMPLETED", confirmedAt: { not: null } },
      },
      _sum: { totalAmount: true },
    }),
    db.payment.count({ where: { status: "PENDING" } }),
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
