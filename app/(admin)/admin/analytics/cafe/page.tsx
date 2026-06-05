import { db } from "@/lib/db";
import { getCafeKPIStats } from "@/actions/admin-cafe-analytics";
import { CafeAnalyticsDashboard } from "./cafe-analytics-dashboard";

export default async function CafeAnalyticsPage() {
  const now = new Date();
  const dateTo = now.toISOString().split("T")[0];

  // Default range = earliest cafe order date → today, so the KPI
  // totals match the lifetime cafe totals out of the box. Admins
  // can narrow the window with the date inputs.
  const earliest = await db.cafeOrder.findFirst({
    where: { status: { not: "PENDING_PAYMENT" } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  const dateFrom = earliest?.createdAt
    ? earliest.createdAt.toISOString().split("T")[0]
    : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];

  const kpiRes = await getCafeKPIStats(dateFrom, dateTo);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Cafe Analytics</h1>
        <p className="mt-1 text-zinc-400">
          Revenue, profit, items, payments, and customer insights for the
          cafe. Sports analytics live on the <strong>Sports</strong> tab.
        </p>
      </div>
      <CafeAnalyticsDashboard
        initialKPI={kpiRes.success && kpiRes.data ? kpiRes.data : null}
        defaultDateFrom={dateFrom}
        defaultDateTo={dateTo}
      />
    </div>
  );
}
