import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { getCafeKPIStats } from "@/actions/admin-cafe-analytics";

/**
 * GET /api/mobile/admin/analytics/cafe?from=&to=
 *
 * Cafe KPI dashboard backing AdminCafeAnalyticsScreen. Mirrors the web
 * /admin/analytics/cafe page: default range is "earliest cafe order →
 * today" so lifetime cafe totals match out of the box. Pass ?from / ?to
 * (YYYY-MM-DD) to narrow the window.
 *
 * Returns the getCafeKPIStats payload shape (CafeKPI):
 *   { totalRevenue, totalCost, totalProfit, profitMargin, totalOrders,
 *     totalItemsSold, avgOrderValue, cancellationRate, discountGiven,
 *     uniqueCustomers, refundsDue }
 * All cafe money is in RUPEES (Float) — the cafe migration converted
 * every cafe price column to rupees, so no /100 conversion is needed.
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
    // Default range = earliest non-abandoned cafe order → today, matching
    // the web cafe page so lifetime KPI totals line up.
    const earliest = await db.cafeOrder.findFirst({
      where: { status: { not: "PENDING_PAYMENT" } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    dateFrom = earliest?.createdAt
      ? earliest.createdAt.toISOString().split("T")[0]
      : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0];
  }

  const result = await getCafeKPIStats(dateFrom, dateTo, true);
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
