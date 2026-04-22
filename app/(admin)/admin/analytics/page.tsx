import { getKPIStats } from "@/actions/admin-analytics";
import { db } from "@/lib/db";
import { AnalyticsDashboard } from "./analytics-dashboard";

export default async function AnalyticsPage() {
  const now = new Date();
  const dateTo = now.toISOString().split("T")[0];

  // Default range = "earliest confirmed payment" → today, so the KPI
  // totals on this page match the lifetime "Total Revenue" on /admin/bookings
  // out of the box. Admins can still narrow the window via the filter.
  // Using payment.confirmedAt (not booking.date) because KPI sports/cafe
  // revenue is bucketed by confirmedAt; a future-dated booking that's
  // already paid should count today, not on its play date.
  const earliestPayment = await db.payment.findFirst({
    where: { status: "COMPLETED", confirmedAt: { not: null } },
    orderBy: { confirmedAt: "asc" },
    select: { confirmedAt: true },
  });
  const dateFrom = earliestPayment?.confirmedAt
    ? earliestPayment.confirmedAt.toISOString().split("T")[0]
    : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];

  const kpiResult = await getKPIStats(dateFrom, dateTo);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Analytics</h1>
        <p className="mt-1 text-zinc-400">
          Revenue, bookings, and performance insights
        </p>
      </div>
      <AnalyticsDashboard
        initialKPI={kpiResult.success && kpiResult.data ? kpiResult.data : null}
        defaultDateFrom={dateFrom}
        defaultDateTo={dateTo}
      />
    </div>
  );
}
