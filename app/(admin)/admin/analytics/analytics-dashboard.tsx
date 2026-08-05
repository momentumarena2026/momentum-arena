"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
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
  getKPIStats,
  getRevenueOverTime,
  getSportRevenueBreakdown,
  getSportRevenueByMonth,
  getPeakHourAnalysis,
  getTopCustomers,
  getPaymentMethodBreakdown,
} from "@/actions/admin-analytics";
import { formatHourCompact } from "@/lib/court-config";
import {
  DailyEarningsChart,
  MonthlyEarningsChart,
  RevenueBreakdownChart,
} from "./earnings-charts";

// --------------- Types ---------------

interface KPIData {
  totalRevenue: number;
  sportsRevenue: number;
  cafeRevenue: number;
  totalBookings: number;
  totalOrders: number;
  avgBookingValue: number;
  cancellationRate: number;
  activeCustomers: number;
}

// Scope is locked to "sports" here — cafe analytics live on
// /admin/analytics/cafe with their own dashboard. Kept as a type
// for the existing RevenueOverTime action's signature.
type Scope = "sports";
type GroupBy = "day" | "week" | "month";

// --------------- Helpers ---------------

// All analytics values are normalized to rupees on the server (see
// actions/admin-analytics.ts). This keeps display logic unit-free.
function formatINR(rupees: number): string {
  return `\u20B9${rupees.toLocaleString("en-IN")}`;
}

// --------------- Color constants ---------------

const SPORT_COLORS: Record<string, string> = {
  Cricket: "#10b981",
  Football: "#3b82f6",
  Pickleball: "#f59e0b",
};

const PAYMENT_COLORS: Record<string, string> = {
  Razorpay: "#3b82f6",
  UPI: "#10b981",
  RAZORPAY: "#3b82f6",
  UPI_QR: "#10b981",
  Cash: "#f59e0b",
  CASH: "#f59e0b",
  Free: "#6b7280",
  FREE: "#6b7280",
};

// --------------- Skeleton ---------------

function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-zinc-800 ${className}`}
    />
  );
}

function ChartSkeleton() {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <Skeleton className="mb-4 h-5 w-40" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

// --------------- Custom Tooltip ---------------

function ChartTooltip({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
  formatter?: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const fmt = formatter || formatINR;
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 shadow-lg">
      <p className="mb-1 text-xs text-zinc-400">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="text-sm font-medium" style={{ color: entry.color }}>
          {entry.name}: {fmt(entry.value)}
        </p>
      ))}
    </div>
  );
}

// --------------- Main Component ---------------

interface Props {
  initialKPI: KPIData | null;
  defaultDateFrom: string;
  defaultDateTo: string;
}

export function AnalyticsDashboard({
  initialKPI,
  defaultDateFrom,
  defaultDateTo,
}: Props) {
  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(defaultDateTo);
  const [groupBy, setGroupBy] = useState<GroupBy>("day");
  // Locked to "sports" — see top-of-file note.
  const scope: Scope = "sports";

  const [kpi, setKpi] = useState<KPIData | null>(initialKPI);
  const [revenueData, setRevenueData] = useState<
    Array<{
      period: string;
      sportsRevenue: number;
      cafeRevenue: number;
      totalRevenue: number;
    }>
  >([]);
  const [sportBreakdown, setSportBreakdown] = useState<
    Array<{ sport: string; revenue: number; bookingCount: number }>
  >([]);
  // Monthly multi-line series — one numeric key per sport. Sports
  // labels are returned alongside the data because Recharts needs
  // an explicit Line per series.
  const [sportMonthly, setSportMonthly] = useState<
    Array<Record<string, number | string>>
  >([]);
  const [sportMonthlyLabels, setSportMonthlyLabels] = useState<string[]>([]);
  const [peakHours, setPeakHours] = useState<
    Array<{ hour: number; bookingCount: number }>
  >([]);
  const [topCustomers, setTopCustomers] = useState<
    Array<{
      userId: string;
      name: string;
      email: string;
      totalSpent: number;
      bookingCount: number;
      orderCount: number;
    }>
  >([]);
  const [paymentMethods, setPaymentMethods] = useState<
    Array<{ method: string; count: number; amount: number }>
  >([]);

  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [kpiRes, revRes, sportRes, sportMonRes, peakRes, custRes, payRes] =
        await Promise.all([
          getKPIStats(dateFrom, dateTo),
          getRevenueOverTime({ dateFrom, dateTo, scope, groupBy }),
          getSportRevenueBreakdown(dateFrom, dateTo),
          getSportRevenueByMonth(dateFrom, dateTo),
          getPeakHourAnalysis(dateFrom, dateTo),
          getTopCustomers(dateFrom, dateTo),
          getPaymentMethodBreakdown(dateFrom, dateTo),
        ]);

      if (kpiRes.success && kpiRes.data) setKpi(kpiRes.data);
      if (revRes.success && revRes.data) setRevenueData(revRes.data);
      if (sportRes.success && sportRes.data) setSportBreakdown(sportRes.data);
      if (sportMonRes.success && sportMonRes.data) {
        setSportMonthly(sportMonRes.data);
        setSportMonthlyLabels(sportMonRes.sports ?? []);
      }
      if (peakRes.success && peakRes.data) setPeakHours(peakRes.data);
      if (custRes.success && custRes.data) setTopCustomers(custRes.data);
      if (payRes.success && payRes.data) setPaymentMethods(payRes.data);
    } catch (err) {
      console.error("Analytics fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, scope, groupBy]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // --------------- KPI Cards ---------------

  const kpiCards = kpi
    ? [
        {
          label: "Sports Earnings",
          value: formatINR(kpi.sportsRevenue),
          color: "text-emerald-400",
        },
        {
          label: "Total Bookings",
          value: kpi.totalBookings.toLocaleString("en-IN"),
          color: "text-white",
        },
        {
          label: "Avg Booking Value",
          value: formatINR(kpi.avgBookingValue),
          color: "text-white",
        },
        {
          label: "Cancellation Rate",
          value: `${kpi.cancellationRate}%`,
          color:
            kpi.cancellationRate > 10 ? "text-red-400" : "text-emerald-400",
        },
        {
          label: "Active Customers",
          value: kpi.activeCustomers.toLocaleString("en-IN"),
          color: "text-white",
        },
      ]
    : [];

  // --------------- Pie helpers ---------------

  const sportPieData = sportBreakdown.map((s) => ({
    name: s.sport.charAt(0).toUpperCase() + s.sport.slice(1).toLowerCase(),
    value: s.revenue,
  }));

  const paymentPieData = paymentMethods.map((p) => ({
    name: p.method === "UPI_QR" ? "UPI" : p.method.charAt(0).toUpperCase() + p.method.slice(1).toLowerCase(),
    value: p.amount,
  }));

  // --------------- Render ---------------

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
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
          <label className="mb-1 block text-xs text-zinc-400">Group by</label>
          <div className="flex gap-1">
            {(["day", "week", "month"] as GroupBy[]).map((g) => (
              <button
                key={g}
                onClick={() => setGroupBy(g)}
                className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                  groupBy === g
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                    : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"
                }`}
              >
                {g.charAt(0).toUpperCase() + g.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      {loading && !kpi ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {kpiCards.map((card) => (
            <div
              key={card.label}
              className="rounded-xl border border-zinc-800 bg-zinc-900 p-4"
            >
              <p className="text-xs text-zinc-400">{card.label}</p>
              <p className={`mt-1 text-xl font-bold ${card.color}`}>
                {card.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Earnings by booking date — day-wise + month-wise. These use their
          own internal filter (month/year selector + compare) independent of
          the top-level date range, since they're framed as "what did we
          earn on calendar day X" rather than "recognized money in window". */}
      <DailyEarningsChart />

      <RevenueBreakdownChart />
      <MonthlyEarningsChart />

      {/* Earnings Over Time */}
      {loading ? (
        <ChartSkeleton />
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="mb-4 text-sm font-semibold text-white">
            Earnings Over Time
          </h2>
          {revenueData.length === 0 ? (
            <p className="py-12 text-center text-zinc-500">
              No earnings data for this period
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={revenueData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis
                  dataKey="period"
                  tick={{ fill: "#a1a1aa", fontSize: 12 }}
                  tickFormatter={(v: string) => {
                    if (groupBy === "month") return v;
                    const d = new Date(v);
                    return `${d.getDate()}/${d.getMonth() + 1}`;
                  }}
                />
                <YAxis
                  tick={{ fill: "#a1a1aa", fontSize: 12 }}
                  tickFormatter={(v: number) => formatINR(v)}
                />
                <Tooltip
                  content={({ active, payload, label }) => (
                    <ChartTooltip
                      active={active}
                      payload={payload as unknown as Array<{ name: string; value: number; color: string }>}
                      label={typeof label === "number" ? String(label) : label}
                    />
                  )}
                />
                <Legend
                  wrapperStyle={{ color: "#a1a1aa", fontSize: 12 }}
                />
                <Line
                  type="monotone"
                  dataKey="sportsRevenue"
                  name="Sports"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {/* Sport Earnings Breakdown — full width now that the cafe pie
          has moved to its own /admin/analytics/cafe dashboard. */}
      {loading ? (
        <ChartSkeleton />
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="mb-4 text-sm font-semibold text-white">
            Sport Earnings Breakdown
          </h2>
          {sportPieData.length === 0 ? (
            <p className="py-12 text-center text-zinc-500">No data</p>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <PieChart>
                <Pie
                  data={sportPieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={120}
                  label={({ name, percent }) =>
                    `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
                  }
                  labelLine={{ stroke: "#a1a1aa" }}
                >
                  {sportPieData.map((entry) => (
                    <Cell
                      key={entry.name}
                      fill={SPORT_COLORS[entry.name] || "#6b7280"}
                    />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => (
                    <ChartTooltip
                      active={active}
                      payload={payload as unknown as Array<{ name: string; value: number; color: string }>}
                    />
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {/* Monthly earnings per sport — one line per sport across
          the selected window. Lines share the same SPORT_COLORS
          palette as the breakdown pie so the visual identity
          carries between the two charts. */}
      {loading ? (
        <ChartSkeleton />
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="mb-1 text-sm font-semibold text-white">
            Sport Earnings by Month
          </h2>
          <p className="mb-4 text-xs text-zinc-500">
            Monthly totals per sport across the selected window.
          </p>
          {sportMonthly.length === 0 || sportMonthlyLabels.length === 0 ? (
            <p className="py-12 text-center text-zinc-500">
              No data for this period
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={sportMonthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis
                  dataKey="period"
                  tick={{ fill: "#a1a1aa", fontSize: 12 }}
                  tickFormatter={(v: string) => {
                    // "2026-03" → "Mar 26"
                    const [y, m] = v.split("-");
                    const date = new Date(Number(y), Number(m) - 1, 1);
                    return date.toLocaleDateString("en-IN", {
                      month: "short",
                      year: "2-digit",
                    });
                  }}
                />
                <YAxis
                  tick={{ fill: "#a1a1aa", fontSize: 12 }}
                  tickFormatter={(v: number) => formatINR(v)}
                />
                <Tooltip
                  content={({ active, payload, label }) => (
                    <ChartTooltip
                      active={active}
                      payload={
                        payload as unknown as Array<{
                          name: string;
                          value: number;
                          color: string;
                        }>
                      }
                      label={typeof label === "string" ? label : String(label)}
                    />
                  )}
                />
                <Legend wrapperStyle={{ color: "#a1a1aa", fontSize: 12 }} />
                {sportMonthlyLabels.map((sport) => (
                  <Line
                    key={sport}
                    type="monotone"
                    dataKey={sport}
                    name={sport}
                    stroke={SPORT_COLORS[sport] || "#6b7280"}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {/* Peak Hours + Payment Methods */}
      {loading ? (
        <div className="grid gap-6 md:grid-cols-2">
          <ChartSkeleton />
          <ChartSkeleton />
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {/* Peak Hour Bar Chart */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
            <h2 className="mb-4 text-sm font-semibold text-white">
              Peak Booking Hours
            </h2>
            {peakHours.length === 0 ? (
              <p className="py-12 text-center text-zinc-500">No data</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={peakHours}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis
                    dataKey="hour"
                    tick={{ fill: "#a1a1aa", fontSize: 12 }}
                    tickFormatter={(v: number) => formatHourCompact(v)}
                  />
                  <YAxis tick={{ fill: "#a1a1aa", fontSize: 12 }} />
                  <Tooltip
                    content={({ active, payload, label }) => (
                      <ChartTooltip
                        active={active}
                        payload={payload as unknown as Array<{ name: string; value: number; color: string }>}
                        label={typeof label === "number" ? formatHourCompact(label) : label}
                        formatter={(v) => `${v} bookings`}
                      />
                    )}
                  />
                  <Bar
                    dataKey="bookingCount"
                    name="Bookings"
                    fill="#10b981"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Payment Method Donut */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
            <h2 className="mb-4 text-sm font-semibold text-white">
              Payment Methods
            </h2>
            {paymentPieData.length === 0 ? (
              <p className="py-12 text-center text-zinc-500">No data</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={paymentPieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    label={({ name, percent }) =>
                      `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
                    }
                    labelLine={{ stroke: "#a1a1aa" }}
                  >
                    {paymentPieData.map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={PAYMENT_COLORS[entry.name] || "#6b7280"}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => (
                      <ChartTooltip
                        active={active}
                        payload={payload as unknown as Array<{ name: string; value: number; color: string }>}
                      />
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      {/* Top Customers Table */}
      {loading ? (
        <ChartSkeleton />
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="mb-4 text-sm font-semibold text-white">
            Top Customers
          </h2>
          {topCustomers.length === 0 ? (
            <p className="py-12 text-center text-zinc-500">No data</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-left">
                    <th className="pb-3 pr-4 font-medium text-zinc-400">#</th>
                    <th className="pb-3 pr-4 font-medium text-zinc-400">
                      Customer
                    </th>
                    <th className="pb-3 pr-4 font-medium text-zinc-400 text-right">
                      Total Spent
                    </th>
                    <th className="pb-3 font-medium text-zinc-400 text-right">
                      Bookings
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {topCustomers.map((customer, i) => (
                    <tr
                      key={customer.userId}
                      className="border-b border-zinc-800/50 last:border-0"
                    >
                      <td className="py-3 pr-4 text-zinc-500">{i + 1}</td>
                      <td className="py-3 pr-4">
                        <p className="font-medium text-white">
                          {customer.name}
                        </p>
                        {customer.email && (
                          <p className="text-xs text-zinc-500">
                            {customer.email}
                          </p>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-right font-medium text-emerald-400">
                        {formatINR(customer.totalSpent)}
                      </td>
                      <td className="py-3 text-right text-zinc-300">
                        {customer.bookingCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
