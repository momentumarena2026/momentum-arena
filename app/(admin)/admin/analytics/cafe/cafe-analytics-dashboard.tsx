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
  getCafeKPIStats,
  getCafeRevenueOverTime,
  getCafeCategoryBreakdown,
  getCafeTopItems,
  getCafePaymentMethodBreakdown,
  getCafePeakHours,
  getCafeStatusBreakdown,
  getCafeVegBreakdown,
  getCafeFulfilmentBreakdown,
  getCafeTopCustomers,
  getCafeDayOfWeekBreakdown,
  type CafeKPI,
  type CafeTimeBucket,
  type CafeCategoryRow,
  type CafeTopItem,
  type CafePaymentMethodRow,
  type CafeHourBucket,
  type CafeStatusRow,
  type VegRow,
  type FulfilmentRow,
  type CafeTopCustomer,
  type DayOfWeekRow,
  type CafeGroupBy,
} from "@/actions/admin-cafe-analytics";

// ─────────── Helpers ───────────

function formatINR(rupees: number): string {
  return `₹${Math.round(rupees).toLocaleString("en-IN")}`;
}

function formatINRDecimal(rupees: number): string {
  return `₹${rupees.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function formatHourCompact(h: number): string {
  if (h === 0) return "12am";
  if (h === 12) return "12pm";
  if (h < 12) return `${h}am`;
  return `${h - 12}pm`;
}

// ─────────── Color palettes ───────────

const CATEGORY_COLORS: Record<string, string> = {
  SNACKS: "#f59e0b",
  BEVERAGES: "#8b5cf6",
  MEALS: "#10b981",
  DESSERTS: "#ec4899",
  COMBOS: "#3b82f6",
};

const PAYMENT_COLORS: Record<string, string> = {
  RAZORPAY: "#3b82f6",
  PHONEPE: "#7c3aed",
  CASH: "#f59e0b",
  UPI_QR: "#10b981",
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: "#eab308",
  PREPARING: "#3b82f6",
  READY: "#a855f7",
  COMPLETED: "#10b981",
  CANCELLED: "#ef4444",
};

const VEG_COLORS: Record<string, string> = {
  Veg: "#10b981",
  "Non-Veg": "#ef4444",
};

const FULFILMENT_COLORS: Record<string, string> = {
  Ready: "#10b981",
  Kitchen: "#f59e0b",
};

// ─────────── Skeletons ───────────

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-zinc-800 ${className}`} />;
}

function ChartSkeleton() {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <Skeleton className="mb-4 h-5 w-40" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

// ─────────── Tooltip ───────────

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
        <p
          key={i}
          className="text-sm font-medium"
          style={{ color: entry.color }}
        >
          {entry.name}: {fmt(entry.value)}
        </p>
      ))}
    </div>
  );
}

// ─────────── Main ───────────

interface Props {
  initialKPI: CafeKPI | null;
  defaultDateFrom: string;
  defaultDateTo: string;
}

export function CafeAnalyticsDashboard({
  initialKPI,
  defaultDateFrom,
  defaultDateTo,
}: Props) {
  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(defaultDateTo);
  const [groupBy, setGroupBy] = useState<CafeGroupBy>("day");

  const [kpi, setKpi] = useState<CafeKPI | null>(initialKPI);
  const [revenueSeries, setRevenueSeries] = useState<CafeTimeBucket[]>([]);
  const [categoryRows, setCategoryRows] = useState<CafeCategoryRow[]>([]);
  const [topItems, setTopItems] = useState<CafeTopItem[]>([]);
  const [paymentRows, setPaymentRows] = useState<CafePaymentMethodRow[]>([]);
  const [hourRows, setHourRows] = useState<CafeHourBucket[]>([]);
  const [statusRows, setStatusRows] = useState<CafeStatusRow[]>([]);
  const [vegRows, setVegRows] = useState<VegRow[]>([]);
  const [fulfilRows, setFulfilRows] = useState<FulfilmentRow[]>([]);
  const [topCustomers, setTopCustomers] = useState<CafeTopCustomer[]>([]);
  const [dowRows, setDowRows] = useState<DayOfWeekRow[]>([]);

  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [
        kpiR,
        revR,
        catR,
        topR,
        payR,
        hourR,
        statR,
        vegR,
        fulR,
        custR,
        dowR,
      ] = await Promise.all([
        getCafeKPIStats(dateFrom, dateTo),
        getCafeRevenueOverTime(dateFrom, dateTo, groupBy),
        getCafeCategoryBreakdown(dateFrom, dateTo),
        getCafeTopItems(dateFrom, dateTo, 10),
        getCafePaymentMethodBreakdown(dateFrom, dateTo),
        getCafePeakHours(dateFrom, dateTo),
        getCafeStatusBreakdown(dateFrom, dateTo),
        getCafeVegBreakdown(dateFrom, dateTo),
        getCafeFulfilmentBreakdown(dateFrom, dateTo),
        getCafeTopCustomers(dateFrom, dateTo, 10),
        getCafeDayOfWeekBreakdown(dateFrom, dateTo),
      ]);
      if (kpiR.success && kpiR.data) setKpi(kpiR.data);
      if (revR.success && revR.data) setRevenueSeries(revR.data);
      if (catR.success && catR.data) setCategoryRows(catR.data);
      if (topR.success && topR.data) setTopItems(topR.data);
      if (payR.success && payR.data) setPaymentRows(payR.data);
      if (hourR.success && hourR.data) setHourRows(hourR.data);
      if (statR.success && statR.data) setStatusRows(statR.data);
      if (vegR.success && vegR.data) setVegRows(vegR.data);
      if (fulR.success && fulR.data) setFulfilRows(fulR.data);
      if (custR.success && custR.data) setTopCustomers(custR.data);
      if (dowR.success && dowR.data) setDowRows(dowR.data);
    } catch (err) {
      console.error("Cafe analytics fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, groupBy]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // ─────────── KPI cards ───────────

  const kpiCards = kpi
    ? [
        {
          label: "Total Revenue",
          value: formatINR(kpi.totalRevenue),
          color: "text-emerald-400",
        },
        {
          label: "Total Profit",
          value: formatINR(kpi.totalProfit),
          color: kpi.totalProfit < 0 ? "text-red-400" : "text-emerald-400",
          sub: `${kpi.profitMargin}% margin`,
        },
        {
          label: "Cost of Goods",
          value: formatINR(kpi.totalCost),
          color: "text-amber-400",
          sub: kpi.totalCost === 0 ? "Set cost prices for accuracy" : undefined,
        },
        {
          label: "Total Orders",
          value: kpi.totalOrders.toLocaleString("en-IN"),
          color: "text-white",
        },
        {
          label: "Avg Order Value",
          value: formatINRDecimal(kpi.avgOrderValue),
          color: "text-white",
        },
        {
          label: "Items Sold",
          value: kpi.totalItemsSold.toLocaleString("en-IN"),
          color: "text-white",
        },
        {
          label: "Discount Given",
          value: formatINR(kpi.discountGiven),
          color: "text-purple-400",
        },
        {
          label: "Unique Customers",
          value: kpi.uniqueCustomers.toLocaleString("en-IN"),
          color: "text-white",
        },
        {
          label: "Cancellation Rate",
          value: `${kpi.cancellationRate}%`,
          color: kpi.cancellationRate > 10 ? "text-red-400" : "text-emerald-400",
        },
        {
          label: "Refunds Due",
          value: kpi.refundsDue.toLocaleString("en-IN"),
          color: kpi.refundsDue > 0 ? "text-red-400" : "text-zinc-400",
          sub:
            kpi.refundsDue > 0
              ? "CANCELLED with captured payment"
              : undefined,
        },
      ]
    : [];

  // ─────────── Pie helpers ───────────

  const categoryPieData = categoryRows.map((c) => ({
    name: titleCase(c.category),
    rawCategory: c.category,
    value: c.revenue,
  }));

  const paymentPieData = paymentRows.map((p) => ({
    name: p.method === "UPI_QR" ? "UPI" : titleCase(p.method),
    rawMethod: p.method,
    value: p.amount,
  }));

  const vegPieData = vegRows.map((v) => ({
    name: v.type,
    value: v.revenue,
  }));

  const fulfilPieData = fulfilRows.map((f) => ({
    name: f.fulfilment,
    value: f.revenue,
  }));

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
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-400">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-400">Group by</label>
          <div className="flex gap-1">
            {(["day", "week", "month"] as CafeGroupBy[]).map((g) => (
              <button
                key={g}
                onClick={() => setGroupBy(g)}
                className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                  groupBy === g
                    ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                    : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"
                }`}
              >
                {titleCase(g)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      {loading && !kpi ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
          {kpiCards.map((card) => (
            <div
              key={card.label}
              className="rounded-xl border border-zinc-800 bg-zinc-900 p-4"
            >
              <p className="text-xs text-zinc-400">{card.label}</p>
              <p className={`mt-1 text-xl font-bold ${card.color}`}>
                {card.value}
              </p>
              {card.sub ? (
                <p className="mt-0.5 text-[10px] text-zinc-500">{card.sub}</p>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {/* Revenue & Profit Over Time */}
      {loading ? (
        <ChartSkeleton />
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="mb-4 text-sm font-semibold text-white">
            Revenue, Profit & Orders Over Time
          </h2>
          {revenueSeries.length === 0 ? (
            <p className="py-12 text-center text-zinc-500">
              No data for this period
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={revenueSeries}>
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
                  yAxisId="left"
                  tick={{ fill: "#a1a1aa", fontSize: 12 }}
                  tickFormatter={(v: number) => formatINR(v)}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fill: "#a1a1aa", fontSize: 12 }}
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
                      label={typeof label === "number" ? String(label) : label}
                    />
                  )}
                />
                <Legend wrapperStyle={{ color: "#a1a1aa", fontSize: 12 }} />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="revenue"
                  name="Revenue"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="profit"
                  name="Profit"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="cost"
                  name="Cost"
                  stroke="#ef4444"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="orders"
                  name="Orders (count)"
                  stroke="#8b5cf6"
                  strokeWidth={1.5}
                  strokeDasharray="2 2"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {/* Category + Payment + Veg + Fulfilment Pies */}
      {loading ? (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          <ChartSkeleton />
          <ChartSkeleton />
          <ChartSkeleton />
          <ChartSkeleton />
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          <PieCard
            title="By Category"
            data={categoryPieData}
            colorFn={(d) =>
              CATEGORY_COLORS[d.rawCategory ?? ""] || "#6b7280"
            }
          />
          <PieCard
            title="Payment Methods"
            data={paymentPieData}
            colorFn={(d) => PAYMENT_COLORS[d.rawMethod ?? ""] || "#6b7280"}
          />
          <PieCard
            title="Veg vs Non-Veg"
            data={vegPieData}
            colorFn={(d) => VEG_COLORS[d.name] || "#6b7280"}
          />
          <PieCard
            title="Ready vs Kitchen"
            data={fulfilPieData}
            colorFn={(d) => FULFILMENT_COLORS[d.name] || "#6b7280"}
          />
        </div>
      )}

      {/* Top Items + Category profit */}
      {loading ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartSkeleton />
          <ChartSkeleton />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Top 10 items by revenue */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
            <h2 className="mb-4 text-sm font-semibold text-white">
              Top 10 Items (by revenue)
            </h2>
            {topItems.length === 0 ? (
              <p className="py-12 text-center text-zinc-500">No data</p>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={topItems} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis
                    type="number"
                    tick={{ fill: "#a1a1aa", fontSize: 12 }}
                    tickFormatter={(v: number) => formatINR(v)}
                  />
                  <YAxis
                    dataKey="itemName"
                    type="category"
                    tick={{ fill: "#a1a1aa", fontSize: 11 }}
                    width={120}
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
                        label={String(label)}
                      />
                    )}
                  />
                  <Legend wrapperStyle={{ color: "#a1a1aa", fontSize: 12 }} />
                  <Bar
                    dataKey="revenue"
                    name="Revenue"
                    fill="#10b981"
                    radius={[0, 4, 4, 0]}
                  />
                  <Bar
                    dataKey="profit"
                    name="Profit"
                    fill="#f59e0b"
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Category-level revenue + profit bar */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
            <h2 className="mb-4 text-sm font-semibold text-white">
              Category Revenue & Profit
            </h2>
            {categoryRows.length === 0 ? (
              <p className="py-12 text-center text-zinc-500">No data</p>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart
                  data={categoryRows.map((c) => ({
                    ...c,
                    category: titleCase(c.category),
                  }))}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis
                    dataKey="category"
                    tick={{ fill: "#a1a1aa", fontSize: 12 }}
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
                        label={String(label)}
                      />
                    )}
                  />
                  <Legend wrapperStyle={{ color: "#a1a1aa", fontSize: 12 }} />
                  <Bar
                    dataKey="revenue"
                    name="Revenue"
                    fill="#10b981"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="profit"
                    name="Profit"
                    fill="#f59e0b"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      {/* Peak Hours + Day of Week */}
      {loading ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartSkeleton />
          <ChartSkeleton />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
            <h2 className="mb-4 text-sm font-semibold text-white">
              Peak Order Hours
            </h2>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={hourRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis
                  dataKey="hour"
                  tick={{ fill: "#a1a1aa", fontSize: 11 }}
                  tickFormatter={(v: number) => formatHourCompact(v)}
                />
                <YAxis tick={{ fill: "#a1a1aa", fontSize: 12 }} />
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
                      label={
                        typeof label === "number"
                          ? formatHourCompact(label)
                          : String(label)
                      }
                      formatter={(v) => `${v} orders`}
                    />
                  )}
                />
                <Bar
                  dataKey="orderCount"
                  name="Orders"
                  fill="#f59e0b"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
            <h2 className="mb-4 text-sm font-semibold text-white">
              Orders by Day of Week
            </h2>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={dowRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis
                  dataKey="day"
                  tick={{ fill: "#a1a1aa", fontSize: 12 }}
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fill: "#a1a1aa", fontSize: 12 }}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
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
                      label={String(label)}
                    />
                  )}
                />
                <Legend wrapperStyle={{ color: "#a1a1aa", fontSize: 12 }} />
                <Bar
                  yAxisId="left"
                  dataKey="orderCount"
                  name="Orders"
                  fill="#8b5cf6"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  yAxisId="right"
                  dataKey="revenue"
                  name="Revenue"
                  fill="#10b981"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Order Status Bar + Top Customers */}
      {loading ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartSkeleton />
          <ChartSkeleton />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
            <h2 className="mb-4 text-sm font-semibold text-white">
              Order Status Mix
            </h2>
            {statusRows.length === 0 ? (
              <p className="py-12 text-center text-zinc-500">No data</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={statusRows}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis
                    dataKey="status"
                    tick={{ fill: "#a1a1aa", fontSize: 11 }}
                  />
                  <YAxis tick={{ fill: "#a1a1aa", fontSize: 12 }} />
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
                        label={String(label)}
                        formatter={(v) => `${v} orders`}
                      />
                    )}
                  />
                  <Bar dataKey="count" name="Orders" radius={[4, 4, 0, 0]}>
                    {statusRows.map((s) => (
                      <Cell
                        key={s.status}
                        fill={STATUS_COLORS[s.status] || "#6b7280"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
            <h2 className="mb-4 text-sm font-semibold text-white">
              Top Customers
            </h2>
            {topCustomers.length === 0 ? (
              <p className="py-12 text-center text-zinc-500">No customers</p>
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
                        Spent
                      </th>
                      <th className="pb-3 font-medium text-zinc-400 text-right">
                        Orders
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {topCustomers.map((c, i) => (
                      <tr
                        key={c.userId}
                        className="border-b border-zinc-800/50 last:border-0"
                      >
                        <td className="py-3 pr-4 text-zinc-500">{i + 1}</td>
                        <td className="py-3 pr-4">
                          <p className="font-medium text-white">{c.name}</p>
                          {c.email && (
                            <p className="text-xs text-zinc-500">{c.email}</p>
                          )}
                        </td>
                        <td className="py-3 pr-4 text-right font-medium text-emerald-400">
                          {formatINR(c.totalSpent)}
                        </td>
                        <td className="py-3 text-right text-zinc-300">
                          {c.orderCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────── Helpers ───────────

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/_/g, " ");
}

// Small wrapper for the four pie cards. Keeps the JSX above
// readable by hiding the recharts boilerplate.
function PieCard({
  title,
  data,
  colorFn,
}: {
  title: string;
  data: Array<{ name: string; value: number; rawCategory?: string; rawMethod?: string }>;
  colorFn: (d: { name: string; rawCategory?: string; rawMethod?: string }) => string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <h2 className="mb-4 text-sm font-semibold text-white">{title}</h2>
      {data.length === 0 ? (
        <p className="py-12 text-center text-zinc-500">No data</p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={80}
              label={({ name, percent }) =>
                `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
              }
              labelLine={{ stroke: "#a1a1aa" }}
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={colorFn(entry)} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => (
                <ChartTooltip
                  active={active}
                  payload={
                    payload as unknown as Array<{
                      name: string;
                      value: number;
                      color: string;
                    }>
                  }
                />
              )}
            />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
