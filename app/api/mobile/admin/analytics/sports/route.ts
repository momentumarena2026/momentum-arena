import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import {
  getKPIStats,
  getRevenueOverTime,
  getSportRevenueBreakdown,
  getSportRevenueByMonth,
  getPeakHourAnalysis,
  getTopCustomers,
  getPaymentMethodBreakdown,
  getDailyEarningsForMonth,
  getMonthlyEarningsForYear,
} from "@/actions/admin-analytics";

/**
 * GET /api/mobile/admin/analytics/sports?from=&to=&groupBy=&month=&year=&monthlyYear=
 *
 * Sports analytics dashboard backing AdminSportsAnalyticsScreen. Full
 * parity with the web /admin/analytics/sports page: returns the KPI plus
 * every chart dataset in ONE payload so the screen issues a single fetch.
 *
 * Default range is "earliest confirmed payment → today" so lifetime
 * totals match /admin/bookings out of the box. Pass ?from / ?to
 * (YYYY-MM-DD) to narrow the window, ?groupBy=day|week|month for the
 * earnings-over-time bucketing (default "day"), and ?month/?year /
 * ?monthlyYear to drive the calendar-keyed daily / monthly earnings
 * charts (default = current month / current year, matching web).
 *
 * Each analytics server action is invoked with skipAuth=true — this route
 * already authenticated via getMobileAdmin + the VIEW_ANALYTICS check
 * below, so the actions must NOT re-run the web cookie-session check
 * (which would throw in the mobile request context).
 *
 * Money is in RUPEES everywhere (the actions normalize cafe paise →
 * rupees server-side), so the screen renders with formatRupees directly.
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

  // Earnings-over-time bucketing — mirrors web's groupBy toggle.
  const groupByRaw = sp.get("groupBy");
  const groupBy: "day" | "week" | "month" =
    groupByRaw === "week" || groupByRaw === "month" ? groupByRaw : "day";

  // Calendar-keyed earnings charts use their own month/year selectors
  // independent of the top-level range (matching the web earnings-charts
  // component, which defaults to the current month + current year).
  const month = clampInt(sp.get("month"), now.getMonth() + 1, 1, 12);
  const year = clampInt(
    sp.get("year"),
    now.getFullYear(),
    2000,
    now.getFullYear() + 1,
  );
  const monthlyYear = clampInt(
    sp.get("monthlyYear"),
    now.getFullYear(),
    2000,
    now.getFullYear() + 1,
  );

  const [
    kpiRes,
    revRes,
    sportRes,
    sportMonRes,
    peakRes,
    custRes,
    payRes,
    dailyRes,
    monthlyRes,
  ] = await Promise.all([
    getKPIStats(dateFrom, dateTo, true),
    getRevenueOverTime(
      { dateFrom, dateTo, scope: "sports", groupBy },
      true,
    ),
    getSportRevenueBreakdown(dateFrom, dateTo, true),
    getSportRevenueByMonth(dateFrom, dateTo, true),
    getPeakHourAnalysis(dateFrom, dateTo, true),
    getTopCustomers(dateFrom, dateTo, 10, true),
    getPaymentMethodBreakdown(dateFrom, dateTo, true),
    getDailyEarningsForMonth(year, month, true),
    getMonthlyEarningsForYear(monthlyYear, true),
  ]);

  if (!kpiRes.success || !kpiRes.data) {
    return NextResponse.json(
      { error: kpiRes.error || "Failed to load analytics" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    range: { from: dateFrom, to: dateTo },
    groupBy,
    kpi: kpiRes.data,
    revenueOverTime: revRes.success && revRes.data ? revRes.data : [],
    sportBreakdown: sportRes.success && sportRes.data ? sportRes.data : [],
    sportMonthly: sportMonRes.success && sportMonRes.data ? sportMonRes.data : [],
    sportMonthlyLabels:
      sportMonRes.success && sportMonRes.sports ? sportMonRes.sports : [],
    peakHours: peakRes.success && peakRes.data ? peakRes.data : [],
    topCustomers: custRes.success && custRes.data ? custRes.data : [],
    paymentMethods: payRes.success && payRes.data ? payRes.data : [],
    dailyEarnings: {
      year,
      month,
      data: dailyRes.success && dailyRes.data ? dailyRes.data : [],
    },
    monthlyEarnings: {
      year: monthlyYear,
      data: monthlyRes.success && monthlyRes.data ? monthlyRes.data : [],
    },
  });
}

/**
 * Parse an integer query param, falling back to `fallback` when missing
 * or out of [min, max]. Keeps the month/year selectors from feeding
 * garbage into the earnings actions.
 */
function clampInt(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}
