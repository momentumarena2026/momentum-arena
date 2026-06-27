import { db } from "@/lib/db";
import {
  getPushAnalytics,
  getDispatchedKinds,
} from "@/actions/admin-push-analytics";
import { PushAnalyticsDashboard } from "./push-analytics-dashboard";

export default async function PushAnalyticsPage() {
  const now = new Date();
  const dateTo = now.toISOString().split("T")[0];

  // Default range = earliest dispatch → today so the totals match the
  // lifetime push totals out of the box. Falls back to the last 30 days
  // before the dispatch log has any rows (e.g. right after it ships).
  const earliest = await db.pushDispatch.findFirst({
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  const dateFrom = earliest?.createdAt
    ? earliest.createdAt.toISOString().split("T")[0]
    : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];

  const [initial, kinds] = await Promise.all([
    getPushAnalytics({ dateFrom, dateTo }),
    getDispatchedKinds(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Push Analytics</h1>
        <p className="mt-1 text-zinc-400">
          Delivery, volume, and reach for push notifications — by kind, source,
          and over time, plus the device fleet. Send notifications from{" "}
          <strong>Mobile Apps → Push Notifications</strong>. Send metrics are
          captured from when the dispatch log shipped; device metrics are full
          history.
        </p>
      </div>
      <PushAnalyticsDashboard
        initial={initial}
        kinds={kinds}
        defaultDateFrom={dateFrom}
        defaultDateTo={dateTo}
      />
    </div>
  );
}
