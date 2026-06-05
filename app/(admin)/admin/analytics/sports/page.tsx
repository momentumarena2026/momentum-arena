import { getKPIStats } from "@/actions/admin-analytics";
import { db } from "@/lib/db";
import { AnalyticsDashboard } from "../analytics-dashboard";

/**
 * Sports analytics — the original revenue dashboard, now living at
 * /admin/analytics/sports so cafe gets its own /admin/analytics/cafe
 * surface without elements bleeding between the two. The bare
 * /admin/analytics URL redirects here.
 */
export default async function SportsAnalyticsPage() {
  const now = new Date();
  const dateTo = now.toISOString().split("T")[0];

  // Default range = "earliest confirmed payment" → today, so the KPI
  // totals match the lifetime "Total Revenue" on /admin/bookings out
  // of the box. Admins can narrow the window via the filter.
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
        <h1 className="text-2xl font-bold text-white">Sports Analytics</h1>
        <p className="mt-1 text-zinc-400">
          Revenue, bookings, and performance insights for the sports side.
          Cafe analytics live on the <strong>Cafe</strong> tab.
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
