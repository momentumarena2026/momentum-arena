import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import {
  getCafeKPIStats,
  getCafeRevenueOverTime,
  getCafeCategoryBreakdown,
  getCafeTopItems,
  getCafePaymentMethodBreakdown,
  getCafePeakHours,
  getCafeStatusBreakdown,
  getCafeVegBreakdown,
  getCafeFulfilmentBreakdown,
  getCafeTopCustomers,
  getCafeDayOfWeekBreakdown,
  getCafeItemInventoryTable,
  type CafeGroupBy,
} from "@/actions/admin-cafe-analytics";

/**
 * GET /api/mobile/admin/analytics/cafe?from=&to=&groupBy=&invPage=&invPageSize=
 *
 * Full cafe analytics payload backing AdminCafeAnalyticsScreen — the
 * mobile mirror of the web /admin/analytics/cafe dashboard. Returns,
 * in ONE response, every KPI and every chart dataset the web page
 * renders, plus one page of the inventory × sales table.
 *
 * Default range is "earliest non-abandoned cafe order → today" so
 * lifetime cafe totals line up with the web page out of the box. Pass
 * ?from / ?to (YYYY-MM-DD) to narrow the window, ?groupBy=day|week|month
 * to rebucket the revenue series, and ?invPage / ?invPageSize to page
 * the inventory table (defaults: page 1, 20 rows).
 *
 * All cafe money is in RUPEES (Float) — the cafe migration converted
 * every cafe price column to rupees, so no /100 conversion is needed.
 *
 * Auth: the mobile JWT + VIEW_ANALYTICS permission is checked here so
 * rejections come back as clean 401/403 JSON. Every action independently
 * enforces VIEW_ANALYTICS too — requireAdmin resolves this request's
 * Bearer token directly, since the actions run in-process.
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

  const groupByParam = sp.get("groupBy");
  const groupBy: CafeGroupBy =
    groupByParam === "week" || groupByParam === "month" ? groupByParam : "day";

  const invPage = Math.max(1, Number(sp.get("invPage")) || 1);
  const invPageSize = Math.min(
    100,
    Math.max(1, Number(sp.get("invPageSize")) || 20),
  );

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

  // Fire every fetcher in parallel — each re-checks VIEW_ANALYTICS itself.
  const [
    kpiR,
    revR,
    catR,
    topR,
    payR,
    hourR,
    statR,
    vegR,
    fulR,
    custR,
    dowR,
    invR,
  ] = await Promise.all([
    getCafeKPIStats(dateFrom, dateTo),
    getCafeRevenueOverTime(dateFrom, dateTo, groupBy),
    getCafeCategoryBreakdown(dateFrom, dateTo),
    getCafeTopItems(dateFrom, dateTo, 10),
    getCafePaymentMethodBreakdown(dateFrom, dateTo),
    getCafePeakHours(dateFrom, dateTo),
    getCafeStatusBreakdown(dateFrom, dateTo),
    getCafeVegBreakdown(dateFrom, dateTo),
    getCafeFulfilmentBreakdown(dateFrom, dateTo),
    getCafeTopCustomers(dateFrom, dateTo, 10),
    getCafeDayOfWeekBreakdown(dateFrom, dateTo),
    getCafeItemInventoryTable(dateFrom, dateTo, invPage, invPageSize),
  ]);

  // KPI is the one block we hard-fail on — without it the screen has
  // nothing to render. The chart datasets degrade gracefully to [] so a
  // single slow/failed aggregation doesn't blank the whole dashboard.
  if (!kpiR.success || !kpiR.data) {
    return NextResponse.json(
      { error: kpiR.error || "Failed to load analytics" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    range: { from: dateFrom, to: dateTo },
    groupBy,
    kpi: kpiR.data,
    revenueOverTime: revR.success && revR.data ? revR.data : [],
    categoryBreakdown: catR.success && catR.data ? catR.data : [],
    topItems: topR.success && topR.data ? topR.data : [],
    paymentMethods: payR.success && payR.data ? payR.data : [],
    peakHours: hourR.success && hourR.data ? hourR.data : [],
    statusBreakdown: statR.success && statR.data ? statR.data : [],
    vegBreakdown: vegR.success && vegR.data ? vegR.data : [],
    fulfilmentBreakdown: fulR.success && fulR.data ? fulR.data : [],
    topCustomers: custR.success && custR.data ? custR.data : [],
    dayOfWeekBreakdown: dowR.success && dowR.data ? dowR.data : [],
    inventory:
      invR.success && invR.data
        ? invR.data
        : {
            rows: [],
            page: invPage,
            pageSize: invPageSize,
            total: 0,
            totalPages: 1,
          },
  });
}
