import { getKPIStats } from "@/actions/admin-analytics";
import { AnalyticsDashboard } from "./analytics-dashboard";

export default async function AnalyticsPage() {
  const now = new Date();
  const dateTo = now.toISOString().split("T")[0];
  const dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
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
