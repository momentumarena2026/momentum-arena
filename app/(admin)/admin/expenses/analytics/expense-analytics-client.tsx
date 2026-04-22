"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
  CartesianGrid,
  Legend,
} from "recharts";
import { IndianRupee, Receipt, Layers } from "lucide-react";
import { formatExpenseAmount } from "@/lib/expenses";

interface AnalyticsData {
  totalAmount: number;
  totalCount: number;
  monthlySeries: { month: string; amount: number }[];
  bySpentType: { label: string; amount: number; count: number }[];
  byDoneBy: { label: string; amount: number; count: number }[];
  byPaymentType: { label: string; amount: number; count: number }[];
  byVendor: { label: string; amount: number; count: number }[];
  byToName: { label: string; amount: number; count: number }[];
}

interface Props {
  initialFrom: string;
  initialTo: string;
  data: AnalyticsData;
}

// Sane hand-picked palette — matches the rest of admin analytics.
const PALETTE = [
  "#10b981",
  "#3b82f6",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#22d3ee",
  "#a3e635",
  "#e11d48",
  "#6366f1",
  "#fbbf24",
  "#d946ef",
  "#84cc16",
  "#06b6d4",
];

// Pretty-print the YYYY-MM month keys used on the server. Recharts
// passes tooltip labels as React nodes so we coerce defensively.
function formatMonth(ym: unknown): string {
  if (typeof ym !== "string") return "";
  const [y, m] = ym.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
}

function formatINRCompact(rupees: number): string {
  if (rupees >= 1_00_00_000) return `₹${(rupees / 1_00_00_000).toFixed(1)}Cr`;
  if (rupees >= 1_00_000) return `₹${(rupees / 1_00_000).toFixed(1)}L`;
  if (rupees >= 1_000) return `₹${(rupees / 1_000).toFixed(1)}k`;
  return `₹${rupees}`;
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v) || 0;
  return 0;
}

export function ExpenseAnalyticsClient({
  initialFrom,
  initialTo,
  data,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);

  function applyRange(nextFrom: string, nextTo: string) {
    const qs = new URLSearchParams();
    if (nextFrom) qs.set("from", nextFrom);
    if (nextTo) qs.set("to", nextTo);
    startTransition(() => {
      router.push(`/admin/expenses/analytics?${qs.toString()}`);
    });
  }

  return (
    <div className="space-y-6">
      {/* Date range filter */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide">
            From
          </span>
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              applyRange(e.target.value, to);
            }}
            className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide">
            To
          </span>
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              applyRange(from, e.target.value);
            }}
            className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
          />
        </label>
        {(from || to) && (
          <button
            type="button"
            onClick={() => {
              setFrom("");
              setTo("");
              applyRange("", "");
            }}
            className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-700"
          >
            Clear
          </button>
        )}
        {pending && (
          <span className="text-xs text-zinc-500">Updating…</span>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Kpi
          icon={<IndianRupee className="h-3.5 w-3.5" />}
          label="Total Spent"
          value={formatExpenseAmount(data.totalAmount)}
        />
        <Kpi
          icon={<Receipt className="h-3.5 w-3.5" />}
          label="Entries"
          value={data.totalCount.toLocaleString("en-IN")}
        />
        <Kpi
          icon={<Layers className="h-3.5 w-3.5" />}
          label="Categories"
          value={data.bySpentType.length.toString()}
        />
      </div>

      {/* Monthly trend */}
      <ChartCard title="Monthly Spend">
        {data.monthlySeries.length === 0 ? (
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={data.monthlySeries}>
              <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
              <XAxis
                dataKey="month"
                stroke="#71717a"
                fontSize={12}
                tickFormatter={formatMonth}
              />
              <YAxis
                stroke="#71717a"
                fontSize={12}
                tickFormatter={(v) => formatINRCompact(toNumber(v))}
                width={60}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#18181b",
                  border: "1px solid #27272a",
                  borderRadius: 8,
                  color: "#e4e4e7",
                }}
                labelFormatter={formatMonth}
                formatter={(v) => formatExpenseAmount(toNumber(v))}
              />
              <Line
                type="monotone"
                dataKey="amount"
                stroke="#10b981"
                strokeWidth={2}
                dot={{ fill: "#10b981", r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* Spent Type breakdown — pie + table side by side on lg */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="By Spent Type">
          {data.bySpentType.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={data.bySpentType}
                  dataKey="amount"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  innerRadius={50}
                  paddingAngle={2}
                >
                  {data.bySpentType.map((_, i) => (
                    <Cell
                      key={i}
                      fill={PALETTE[i % PALETTE.length]}
                      stroke="#18181b"
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#18181b",
                    border: "1px solid #27272a",
                    borderRadius: 8,
                    color: "#e4e4e7",
                  }}
                  formatter={(v, _name, ctx) => [
                    formatExpenseAmount(toNumber(v)),
                    (ctx as { payload?: { label?: string } } | undefined)?.payload?.label ?? "",
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Spent Type — Details">
          <CategoryTable rows={data.bySpentType} />
        </ChartCard>
      </div>

      {/* Who spent + payment mix */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Who Spent">
          {data.byDoneBy.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.byDoneBy}>
                <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="#71717a" fontSize={12} />
                <YAxis
                  stroke="#71717a"
                  fontSize={12}
                  tickFormatter={(v) => formatINRCompact(toNumber(v))}
                  width={60}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#18181b",
                    border: "1px solid #27272a",
                    borderRadius: 8,
                    color: "#e4e4e7",
                  }}
                  formatter={(v) => formatExpenseAmount(toNumber(v))}
                />
                <Bar dataKey="amount" fill="#3b82f6" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Payment Mix">
          {data.byPaymentType.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={data.byPaymentType}
                  dataKey="amount"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                >
                  {data.byPaymentType.map((r, i) => (
                    <Cell
                      key={i}
                      fill={
                        r.label === "Cash"
                          ? "#f59e0b"
                          : r.label === "Online"
                          ? "#3b82f6"
                          : PALETTE[(i + 2) % PALETTE.length]
                      }
                      stroke="#18181b"
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#18181b",
                    border: "1px solid #27272a",
                    borderRadius: 8,
                    color: "#e4e4e7",
                  }}
                  formatter={(v) => formatExpenseAmount(toNumber(v))}
                />
                <Legend
                  wrapperStyle={{ color: "#a1a1aa", fontSize: 12 }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Top vendors + top recipients */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Top Vendors">
          <CategoryTable rows={data.byVendor} />
        </ChartCard>
        <ChartCard title="Top Recipients (By)">
          <CategoryTable rows={data.byToName} />
        </ChartCard>
      </div>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-zinc-400 uppercase tracking-wide">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold text-white">{value}</div>
    </div>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <h2 className="text-sm font-medium text-zinc-300 mb-3">{title}</h2>
      {children}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center h-[240px] text-sm text-zinc-500 italic">
      No data for this range.
    </div>
  );
}

function CategoryTable({
  rows,
}: {
  rows: { label: string; amount: number; count: number }[];
}) {
  if (rows.length === 0) return <EmptyState />;
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800">
      <table className="w-full text-sm">
        <thead className="bg-zinc-950 text-left text-xs uppercase tracking-wide text-zinc-500">
          <tr>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium text-right">Amount</th>
            <th className="px-3 py-2 font-medium text-right">%</th>
            <th className="px-3 py-2 font-medium text-right">#</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800">
          {rows.map((r) => (
            <tr key={r.label} className="text-zinc-300">
              <td className="px-3 py-2">{r.label}</td>
              <td className="px-3 py-2 text-right font-medium text-white">
                {formatExpenseAmount(r.amount)}
              </td>
              <td className="px-3 py-2 text-right text-zinc-400">
                {total > 0 ? ((r.amount / total) * 100).toFixed(1) : "0"}%
              </td>
              <td className="px-3 py-2 text-right text-zinc-400">{r.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
