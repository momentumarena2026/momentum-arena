import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { getKPIStats } from "@/actions/admin-analytics";

/**
 * GET /api/mobile/admin/analytics/sports?from=&to=
 *
 * Sports KPI dashboard backing AdminSportsAnalyticsScreen. Mirrors the
 * web /admin/analytics/sports page: default range is "earliest confirmed
 * payment → today" so the lifetime totals match /admin/bookings out of
 * the box. Pass ?from / ?to (YYYY-MM-DD) to narrow the window.
 *
 * Returns the getKPIStats payload shape:
 *   { totalRevenue, sportsRevenue, cafeRevenue, totalBookings,
 *     totalOrders, avgBookingValue, cancellationRate, activeCustomers }
 * Money is in RUPEES (getKPIStats normalizes cafe paise → rupees).
 */
export async function GET(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (
    admin.role !== "SUPERADMIN" &&
    !hasPermission(admin.permissions ?? [], "VIEW_ANALYTICS")
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sp = new URL(request.url).searchParams;
  const now = new Date();
  const dateTo = sp.get("to") || now.toISOString().split("T")[0];

  let dateFrom = sp.get("from") || undefined;
  if (!dateFrom) {
    // Default range = earliest confirmed payment → today, matching the
    // web sports page so lifetime KPI totals line up with /admin/bookings.
    const earliestPayment = await db.payment.findFirst({
      where: { status: "COMPLETED", confirmedAt: { not: null } },
      orderBy: { confirmedAt: "asc" },
      select: { confirmedAt: true },
    });
    dateFrom = earliestPayment?.confirmedAt
      ? earliestPayment.confirmedAt.toISOString().split("T")[0]
      : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0];
  }

  const result = await getKPIStats(dateFrom, dateTo, true);
  if (!result.success || !result.data) {
    return NextResponse.json(
      { error: result.error || "Failed to load analytics" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    range: { from: dateFrom, to: dateTo },
    kpi: result.data,
  });
}
