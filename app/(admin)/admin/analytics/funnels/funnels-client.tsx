"use client";

import { useRouter } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FunnelResult, OverviewKpis } from "@/actions/admin-insights";
import type { FunnelKey } from "@/lib/analytics-funnels";

interface Props {
  initialFunnel: FunnelResult;
  funnelKey: FunnelKey;
  range: { from: string; to: string };
  availableFunnels: { key: FunnelKey; label: string }[];
  overview: OverviewKpis;
}

export function FunnelsClient({
  initialFunnel,
  funnelKey,
  range,
  availableFunnels,
  overview,
}: Props) {
  const router = useRouter();

  function pushParams(updates: Record<string, string>) {
    const params = new URLSearchParams();
    params.set("funnel", funnelKey);
    params.set("from", range.from);
    params.set("to", range.to);
    for (const [k, v] of Object.entries(updates)) params.set(k, v);
    router.push(`/admin/analytics/funnels?${params.toString()}`);
  }

  // Color the first step neutral, then graduate to red as drop-off
  // grows. Visualises "which step is bleeding most" at a glance.
  const colorFor = (dropOffPct: number) => {
    if (dropOffPct === 0) return "#10b981"; // emerald — entry / no drop
    if (dropOffPct < 25) return "#34d399"; // light emerald — small drop
    if (dropOffPct < 50) return "#facc15"; // yellow — moderate
    if (dropOffPct < 75) return "#fb923c"; // orange — heavy
    return "#ef4444"; // red — bleeding
  };

  return (
    <>
      {/* Date / funnel controls */}
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div>
          <label className="block text-xs font-medium uppercase text-zinc-500">
            Funnel
          </label>
          <select
            value={funnelKey}
            onChange={(e) => pushParams({ funnel: e.target.value })}
            className="mt-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
          >
            {availableFunnels.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium uppercase text-zinc-500">From</label>
          <input
            type="date"
            value={range.from}
            onChange={(e) => pushParams({ from: e.target.value })}
            className="mt-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
          />
        </div>
        <div>
          <label className="block text-xs font-medium uppercase text-zinc-500">To</label>
          <input
            type="date"
            value={range.to}
            onChange={(e) => pushParams({ to: e.target.value })}
            className="mt-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
          />
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Tile label="Sessions" value={overview.sessions} />
        <Tile label="Signed-in users" value={overview.signedInUsers} />
        <Tile label="Bookings confirmed" value={overview.bookingsConfirmed} />
        <Tile label="Waitlist joined" value={overview.waitlistJoined} />
        <Tile label="Unmet-demand taps" value={overview.unmetDemandTaps} />
        <Tile
          label="Waitlist conv."
          value={`${overview.waitlistConversionPct}%`}
        />
      </div>

      {/* Funnel chart */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <h2 className="text-base font-semibold text-white">
          {initialFunnel.label} funnel — {range.from} → {range.to}
        </h2>
        {initialFunnel.rows.every((r) => r.count === 0) ? (
          <div className="py-12 text-center text-sm text-zinc-500">
            No events in this window yet. Either nobody hit step 1 or the
            funnel hasn&apos;t been instrumented.
          </div>
        ) : (
          <div className="mt-4 h-80 w-full">
            <ResponsiveContainer>
              <BarChart
                data={initialFunnel.rows}
                margin={{ top: 12, right: 24, bottom: 12, left: 8 }}
              >
                <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                <XAxis
                  dataKey="step"
                  tick={{ fill: "#a1a1aa", fontSize: 11 }}
                  interval={0}
                  angle={-15}
                  textAnchor="end"
                  height={60}
                />
                <YAxis tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#0a0a0a",
                    border: "1px solid #27272a",
                    borderRadius: 8,
                    color: "#fff",
                  }}
                  formatter={(_value, _name, props) => {
                    const r = props.payload as (typeof initialFunnel.rows)[number];
                    return [
                      `${r.count} sessions • ${r.uniqueUsers} users • ${r.ratePct}% of step 1${r.dropOffPct ? ` • -${r.dropOffPct}% from prev` : ""}`,
                      r.step,
                    ];
                  }}
                />
                <Bar dataKey="count">
                  {initialFunnel.rows.map((r, i) => (
                    <Cell key={i} fill={colorFor(r.dropOffPct)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Per-step table */}
      <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/40">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-800 text-left text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-3">Step</th>
              <th className="px-4 py-3 text-right">Sessions</th>
              <th className="px-4 py-3 text-right">Users</th>
              <th className="px-4 py-3 text-right">% of step 1</th>
              <th className="px-4 py-3 text-right">Drop-off</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {initialFunnel.rows.map((r, i) => (
              <tr key={r.step}>
                <td className="px-4 py-2.5">
                  <span className="text-zinc-500">{i + 1}.</span>{" "}
                  <code className="text-zinc-200">{r.step}</code>
                </td>
                <td className="px-4 py-2.5 text-right text-white">{r.count}</td>
                <td className="px-4 py-2.5 text-right text-zinc-400">
                  {r.uniqueUsers}
                </td>
                <td className="px-4 py-2.5 text-right text-zinc-300">
                  {r.ratePct}%
                </td>
                <td
                  className={`px-4 py-2.5 text-right font-medium ${
                    r.dropOffPct === 0
                      ? "text-zinc-500"
                      : r.dropOffPct < 25
                        ? "text-emerald-400"
                        : r.dropOffPct < 50
                          ? "text-yellow-400"
                          : r.dropOffPct < 75
                            ? "text-orange-400"
                            : "text-red-400"
                  }`}
                >
                  {r.dropOffPct === 0 ? "—" : `-${r.dropOffPct}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="text-xs uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold text-white">{value}</div>
    </div>
  );
}
