"use client";

import type { AdminRewardsAnalytics } from "@/actions/admin-rewards";

interface Props {
  analytics: AdminRewardsAnalytics;
}

/**
 * Quick 30-day strip. The full funnel (signup → first_earn →
 * first_redeem → repeat_redeem) lives on /admin/analytics/funnels —
 * see Phase 7. We keep a compact daily-buckets view here so the
 * rewards admin can spot anomalies without leaving the tab.
 */
export function RewardsAnalyticsPanel({ analytics }: Props) {
  const earnMax = Math.max(
    1,
    ...analytics.dailyEarnLast30d.map((d) => d.points),
  );
  const redeemMax = Math.max(
    1,
    ...analytics.dailyRedeemLast30d.map((d) => d.points),
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Daily earn (30d)"
          tone="emerald"
          rows={analytics.dailyEarnLast30d}
          max={earnMax}
        />
        <ChartCard
          title="Daily redeem (30d)"
          tone="sky"
          rows={analytics.dailyRedeemLast30d}
          max={redeemMax}
        />
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Top earners (30d)
        </h3>
        {analytics.topEarners30d.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">No earn activity in the last 30 days.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="text-left font-medium">User</th>
                <th className="text-right font-medium">Points</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {analytics.topEarners30d.map((u) => (
                <tr key={u.userId}>
                  <td className="py-1.5 text-white">{u.name ?? u.userId}</td>
                  <td className="py-1.5 text-right text-emerald-400 font-semibold">
                    {u.points.toLocaleString("en-IN")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ChartCard({
  title,
  tone,
  rows,
  max,
}: {
  title: string;
  tone: "emerald" | "sky";
  rows: { date: string; points: number }[];
  max: number;
}) {
  const fill = tone === "emerald" ? "bg-emerald-500" : "bg-sky-500";
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">No data.</p>
      ) : (
        <div className="mt-3 flex items-end gap-1 h-32">
          {rows.map((r) => {
            const pct = Math.max(2, Math.round((r.points / max) * 100));
            return (
              <div
                key={r.date}
                className="group flex-1 flex flex-col items-center gap-1"
                title={`${r.date}: ${r.points.toLocaleString("en-IN")} pts`}
              >
                <div
                  className={`${fill} w-full rounded-sm opacity-80 group-hover:opacity-100 transition-opacity`}
                  style={{ height: `${pct}%` }}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
