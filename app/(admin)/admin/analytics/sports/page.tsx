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

  // Default range = "earliest confirmed payment" → today, i.e. everything.
  //
  // This deliberately does NOT match the /admin/bookings tile, and used to
  // claim it did. Two reasons it cannot: this KPI adds pass sales,
  // tournament entries, venue hire and camp fees, which that tile has never
  // counted; and this one is cash (payment confirmed) where that one is
  // accrual (booked, collected or not). Both figures now say so on screen.
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
          Earnings, bookings, and performance insights for the sports side.
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
