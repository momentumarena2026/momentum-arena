"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import {
  getPushAnalytics,
  type PushAnalytics,
  type PushAnalyticsFilters,
} from "@/actions/admin-push-analytics";

// ─────────── Helpers ───────────

function fmt(n: number): string {
  return n.toLocaleString("en-IN");
}

function pct(n: number | null): string {
  return n === null ? "—" : `${n}%`;
}

function shortDate(iso: string): string {
  // iso = YYYY-MM-DD
  const [, m, d] = iso.split("-");
  return `${Number(d)}/${Number(m)}`;
}

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─────────── Palettes ───────────

const SOURCE_COLORS: Record<string, string> = {
  event: "#3b82f6",
  broadcast: "#8b5cf6",
  test: "#f59e0b",
};

const PLATFORM_COLORS: Record<string, string> = {
  iOS: "#3b82f6",
  Android: "#10b981",
};

// Stable-ish color for a kind (hash → palette index) so the same kind
// keeps its color across renders without a hardcoded map for all kinds.
const KIND_PALETTE = [
  "#10b981", "#3b82f6", "#8b5cf6", "#f59e0b", "#ec4899",
  "#06b6d4", "#a855f7", "#ef4444", "#84cc16", "#f97316",
];
function kindColor(kind: string): string {
  let h = 0;
  for (let i = 0; i < kind.length; i++) h = (h * 31 + kind.charCodeAt(i)) >>> 0;
  return KIND_PALETTE[h % KIND_PALETTE.length];
}

// ─────────── Small components ───────────

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-zinc-800 ${className}`} />;
}

function ChartCard({
  title,
  children,
  empty,
}: {
  title: string;
  children: React.ReactNode;
  empty?: boolean;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <h2 className="mb-4 text-sm font-semibold text-white">{title}</h2>
      {empty ? (
        <p className="py-12 text-center text-zinc-500">No data for this period</p>
      ) : (
        children
      )}
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  suffix,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
  suffix?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 shadow-lg">
      {label ? <p className="mb-1 text-xs text-zinc-400">{label}</p> : null}
      {payload.map((e, i) => (
        <p key={i} className="text-sm font-medium" style={{ color: e.color }}>
          {e.name}: {fmt(e.value)}
          {suffix ?? ""}
        </p>
      ))}
    </div>
  );
}

// recharts passes a loosely-typed payload; this cast keeps the call sites tidy.
type TipPayload = Array<{ name: string; value: number; color: string }>;

// ─────────── Filter chip ───────────

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "border border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
          : "border border-zinc-700 bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}

// ─────────── Main ───────────

const SOURCES = ["event", "broadcast", "test"] as const;
const SCOPES = ["all", "customer", "admin"] as const;

interface Props {
  initial: PushAnalytics;
  kinds: string[];
  defaultDateFrom: string;
  defaultDateTo: string;
}

export function PushAnalyticsDashboard({
  initial,
  kinds,
  defaultDateFrom,
  defaultDateTo,
}: Props) {
  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(defaultDateTo);
  const [selectedKinds, setSelectedKinds] = useState<string[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [scope, setScope] = useState<"all" | "customer" | "admin">("all");

  const [data, setData] = useState<PushAnalytics>(initial);
  const [loading, setLoading] = useState(false);
  const firstRender = useRef(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const filters: PushAnalyticsFilters = {
        dateFrom,
        dateTo,
        kinds: selectedKinds.length ? selectedKinds : undefined,
        sources: selectedSources.length ? selectedSources : undefined,
        scope,
      };
      const res = await getPushAnalytics(filters);
      setData(res);
    } catch (err) {
      console.error("Push analytics fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, selectedKinds, selectedSources, scope]);

  // Skip the very first run — the server already handed us `initial` for
  // the default filters. Refetch only when a filter actually changes.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    fetchData();
  }, [fetchData]);

  const toggle = (
    list: string[],
    setList: (v: string[]) => void,
    value: string,
  ) =>
    setList(
      list.includes(value) ? list.filter((v) => v !== value) : [...list, value],
    );

  const { totals, fleet } = data;

  const kpis = [
    { label: "Sent (attempted)", value: fmt(totals.attempted), color: "text-white" },
    {
      label: "Delivered",
      value: fmt(totals.succeeded),
      color: "text-emerald-400",
      sub: `${pct(totals.deliveryRate)} delivery rate`,
    },
    {
      label: "Failed",
      value: fmt(totals.failed),
      color: totals.failed > 0 ? "text-red-400" : "text-zinc-400",
    },
    {
      label: "Dead tokens pruned",
      value: fmt(totals.cleanedUp),
      color: "text-amber-400",
      sub: "uninstalled / rotated",
    },
    { label: "Dispatches", value: fmt(totals.dispatches), color: "text-white" },
    { label: "Broadcasts", value: fmt(totals.broadcasts), color: "text-purple-400" },
    {
      label: "Reach (users)",
      value: fmt(fleet.reachUsers),
      color: "text-white",
      sub: "users with ≥1 device",
    },
    {
      label: "Devices",
      value: fmt(fleet.totalDevices),
      color: "text-white",
      sub: `${fmt(fleet.iosDevices)} iOS · ${fmt(fleet.androidDevices)} Android`,
    },
    {
      label: "Active devices",
      value: fmt(fleet.activeDevices),
      color: "text-emerald-400",
      sub: `${fmt(fleet.staleDevices)} stale (30d+)`,
    },
    {
      label: "Admin devices",
      value: fmt(fleet.adminDevices),
      color: "text-white",
      sub: "staff fleet",
    },
  ];

  const platformPie = [
    { name: "iOS", value: fleet.iosDevices },
    { name: "Android", value: fleet.androidDevices },
  ].filter((d) => d.value > 0);

  const sourcePie = data.bySource.map((s) => ({
    name: titleCase(s.source),
    rawSource: s.source,
    value: s.dispatches,
  }));

  return (
    <div className="space-y-6">
      {/* ─────────── Filters ─────────── */}
      <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-xs text-zinc-400">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-400">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Source</label>
            <div className="flex gap-1.5">
              {SOURCES.map((s) => (
                <Chip
                  key={s}
                  active={selectedSources.includes(s)}
                  onClick={() => toggle(selectedSources, setSelectedSources, s)}
                >
                  {titleCase(s)}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Audience scope</label>
            <div className="flex gap-1.5">
              {SCOPES.map((s) => (
                <Chip key={s} active={scope === s} onClick={() => setScope(s)}>
                  {titleCase(s)}
                </Chip>
              ))}
            </div>
          </div>
          {loading ? (
            <span className="ml-auto text-xs text-zinc-500">Updating…</span>
          ) : null}
        </div>

        {kinds.length > 0 && (
          <div>
            <label className="mb-1.5 block text-xs text-zinc-400">
              Kind {selectedKinds.length > 0 ? `(${selectedKinds.length})` : "(all)"}
            </label>
            <div className="flex flex-wrap gap-1.5">
              {kinds.map((k) => (
                <Chip
                  key={k}
                  active={selectedKinds.includes(k)}
                  onClick={() => toggle(selectedKinds, setSelectedKinds, k)}
                >
                  {k}
                </Chip>
              ))}
              {selectedKinds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedKinds([])}
                  className="rounded-lg px-2 py-1.5 text-xs text-zinc-500 hover:text-zinc-300"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ─────────── KPI cards ─────────── */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {kpis.map((c) => (
          <div
            key={c.label}
            className="rounded-xl border border-zinc-800 bg-zinc-900 p-4"
          >
            <p className="text-xs text-zinc-400">{c.label}</p>
            <p className={`mt-1 text-xl font-bold ${c.color}`}>{c.value}</p>
            {c.sub ? (
              <p className="mt-0.5 text-[10px] text-zinc-500">{c.sub}</p>
            ) : null}
          </div>
        ))}
      </div>

      {/* ─────────── Sends over time ─────────── */}
      <ChartCard title="Sends over time" empty={data.timeSeries.length === 0}>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={data.timeSeries}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis
              dataKey="date"
              tick={{ fill: "#a1a1aa", fontSize: 12 }}
              tickFormatter={shortDate}
            />
            <YAxis tick={{ fill: "#a1a1aa", fontSize: 12 }} />
            <Tooltip
              content={({ active, payload, label }) => (
                <ChartTooltip
                  active={active}
                  payload={payload as unknown as TipPayload}
                  label={typeof label === "string" ? label : String(label)}
                />
              )}
            />
            <Legend wrapperStyle={{ color: "#a1a1aa", fontSize: 12 }} />
            <Bar dataKey="succeeded" name="Delivered" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
            <Bar dataKey="failed" name="Failed" stackId="a" fill="#ef4444" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* ─────────── By kind + by source ─────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="By kind (attempted vs delivered)" empty={data.byKind.length === 0}>
          <ResponsiveContainer width="100%" height={Math.max(240, data.byKind.length * 38)}>
            <BarChart data={data.byKind} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis type="number" tick={{ fill: "#a1a1aa", fontSize: 12 }} />
              <YAxis
                dataKey="kind"
                type="category"
                tick={{ fill: "#a1a1aa", fontSize: 11 }}
                width={140}
              />
              <Tooltip
                content={({ active, payload, label }) => (
                  <ChartTooltip
                    active={active}
                    payload={payload as unknown as TipPayload}
                    label={String(label)}
                  />
                )}
              />
              <Legend wrapperStyle={{ color: "#a1a1aa", fontSize: 12 }} />
              <Bar dataKey="attempted" name="Attempted" fill="#3b82f6" radius={[0, 4, 4, 0]} />
              <Bar dataKey="succeeded" name="Delivered" fill="#10b981" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Dispatches by source" empty={sourcePie.length === 0}>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={sourcePie}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={90}
                label={({ name, percent }) =>
                  `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
                }
                labelLine={{ stroke: "#a1a1aa" }}
              >
                {sourcePie.map((e) => (
                  <Cell key={e.name} fill={SOURCE_COLORS[e.rawSource] ?? "#6b7280"} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => (
                  <ChartTooltip
                    active={active}
                    payload={payload as unknown as TipPayload}
                  />
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* ─────────── Fleet: registrations + platform + versions ─────────── */}
      <ChartCard
        title="New device registrations over time"
        empty={fleet.registrations.length === 0}
      >
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={fleet.registrations}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis
              dataKey="date"
              tick={{ fill: "#a1a1aa", fontSize: 12 }}
              tickFormatter={shortDate}
            />
            <YAxis tick={{ fill: "#a1a1aa", fontSize: 12 }} allowDecimals={false} />
            <Tooltip
              content={({ active, payload, label }) => (
                <ChartTooltip
                  active={active}
                  payload={payload as unknown as TipPayload}
                  label={String(label)}
                />
              )}
            />
            <Line
              type="monotone"
              dataKey="count"
              name="New devices"
              stroke="#10b981"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Devices by platform" empty={platformPie.length === 0}>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={platformPie}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={90}
                label={({ name, percent }) =>
                  `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
                }
                labelLine={{ stroke: "#a1a1aa" }}
              >
                {platformPie.map((e) => (
                  <Cell key={e.name} fill={PLATFORM_COLORS[e.name] ?? "#6b7280"} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => (
                  <ChartTooltip
                    active={active}
                    payload={payload as unknown as TipPayload}
                  />
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Devices by app version"
          empty={fleet.byAppVersion.length === 0}
        >
          <ResponsiveContainer
            width="100%"
            height={Math.max(220, fleet.byAppVersion.length * 34)}
          >
            <BarChart data={fleet.byAppVersion} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis type="number" tick={{ fill: "#a1a1aa", fontSize: 12 }} allowDecimals={false} />
              <YAxis
                dataKey="version"
                type="category"
                tick={{ fill: "#a1a1aa", fontSize: 11 }}
                width={110}
              />
              <Tooltip
                content={({ active, payload, label }) => (
                  <ChartTooltip
                    active={active}
                    payload={payload as unknown as TipPayload}
                    label={String(label)}
                  />
                )}
              />
              <Bar dataKey="count" name="Devices" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* ─────────── Recent dispatches ─────────── */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="mb-4 text-sm font-semibold text-white">
          Recent dispatches
        </h2>
        {data.recent.length === 0 ? (
          <p className="py-12 text-center text-zinc-500">
            No dispatches in this period
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-[11px] uppercase tracking-wider text-zinc-500">
                  <th className="px-3 py-2.5 font-medium">When</th>
                  <th className="px-3 py-2.5 font-medium">Kind</th>
                  <th className="px-3 py-2.5 font-medium">Source</th>
                  <th className="px-3 py-2.5 font-medium">Scope</th>
                  <th className="w-full px-3 py-2.5 font-medium">Notification</th>
                  <th className="px-3 py-2.5 text-right font-medium">Sent</th>
                  <th className="px-3 py-2.5 text-right font-medium">Delivered</th>
                  <th className="px-3 py-2.5 text-right font-medium">Failed</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-zinc-800/60 align-top last:border-0"
                  >
                    <td className="whitespace-nowrap px-3 py-3 text-zinc-400">
                      {new Date(r.createdAt).toLocaleString("en-IN", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <span
                        className="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium"
                        style={{
                          backgroundColor: `${kindColor(r.kind)}22`,
                          color: kindColor(r.kind),
                        }}
                      >
                        {r.kind}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-zinc-300">
                      {titleCase(r.source)}
                      {r.audience ? (
                        <span className="block text-[10px] text-zinc-500">
                          {r.audience}
                        </span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-zinc-400">
                      {titleCase(r.scope)}
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-medium text-white">{r.title}</p>
                      {r.body ? (
                        <p className="line-clamp-1 text-xs text-zinc-500">
                          {r.body}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-right text-zinc-300">
                      {fmt(r.attempted)}
                    </td>
                    <td className="px-3 py-3 text-right text-emerald-400">
                      {fmt(r.succeeded)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {r.failed > 0 ? (
                        <span className="text-red-400">{fmt(r.failed)}</span>
                      ) : (
                        <span className="text-zinc-600">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Loading skeleton overlay hint when refetching with no prior data */}
      {loading && data.recent.length === 0 && data.totals.dispatches === 0 ? (
        <Skeleton className="h-2 w-full" />
      ) : null}
    </div>
  );
}
