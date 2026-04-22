"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  getDailyEarningsForMonth,
  getMonthlyEarningsForYear,
} from "@/actions/admin-analytics";

// ---------------------------------------------------------------------------
// Day-wise + month-wise earnings charts with an optional compare period.
//
// "Earnings" here is pre-discount (COALESCE(originalAmount, totalAmount)),
// grouped by Booking.date not payment.confirmedAt — admins wanted "what did
// the court earn on this date" independent of when the money settled. See
// getDailyEarningsForMonth / getMonthlyEarningsForYear for the SQL.
// ---------------------------------------------------------------------------

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function formatINR(rupees: number): string {
  return `\u20B9${rupees.toLocaleString("en-IN")}`;
}

function formatINRShort(rupees: number): string {
  // Y-axis labels: compress 1,23,456 → ₹1.2L, 45,600 → ₹45.6k so the
  // axis doesn't chew horizontal space on mobile.
  if (rupees >= 100000) return `\u20B9${(rupees / 100000).toFixed(1)}L`;
  if (rupees >= 1000) return `\u20B9${(rupees / 1000).toFixed(1)}k`;
  return `\u20B9${rupees}`;
}

// Year dropdown options — last 6 years up to the current one. Stays in
// bounds even if the tenant seeds historical data from before the
// component was written.
function buildYearOptions(): number[] {
  const current = new Date().getFullYear();
  const out: number[] = [];
  for (let y = current; y >= current - 5; y--) out.push(y);
  return out;
}

// ---------------------------------------------------------------------------
// Monthly (day-wise) chart
// ---------------------------------------------------------------------------

interface DailyRow {
  day: number;
  earnings: number;
  bookingCount: number;
}

export function DailyEarningsChart() {
  const now = new Date();
  const years = useMemo(buildYearOptions, []);

  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const [compareEnabled, setCompareEnabled] = useState(false);
  const [cmpYear, setCmpYear] = useState(now.getFullYear());
  const [cmpMonth, setCmpMonth] = useState(
    // Seed compare to "previous month" — most common side-by-side the
    // admin wants is "this vs last". They can change it freely.
    now.getMonth() === 0 ? 12 : now.getMonth()
  );
  useEffect(() => {
    if (compareEnabled && now.getMonth() === 0) {
      setCmpYear(now.getFullYear() - 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareEnabled]);

  const [primary, setPrimary] = useState<DailyRow[]>([]);
  const [compare, setCompare] = useState<DailyRow[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const tasks: Promise<unknown>[] = [getDailyEarningsForMonth(year, month)];
      if (compareEnabled) {
        tasks.push(getDailyEarningsForMonth(cmpYear, cmpMonth));
      }
      const [primaryRes, compareRes] = (await Promise.all(tasks)) as [
        Awaited<ReturnType<typeof getDailyEarningsForMonth>>,
        Awaited<ReturnType<typeof getDailyEarningsForMonth>> | undefined,
      ];

      if (primaryRes.success) setPrimary(primaryRes.data);
      else setPrimary([]);

      if (compareEnabled && compareRes?.success) setCompare(compareRes.data);
      else setCompare([]);
    } finally {
      setLoading(false);
    }
  }, [year, month, compareEnabled, cmpYear, cmpMonth]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Merge the two series into a single "rows keyed by day" array so
  // recharts renders grouped bars. Primary month's day count dictates
  // the x-axis (28-31); the compare series is aligned by day number.
  const chartData = useMemo(() => {
    const cmpMap = new Map<number, number>();
    for (const r of compare) cmpMap.set(r.day, r.earnings);
    return primary.map((r) => ({
      day: r.day,
      primary: r.earnings,
      primaryBookings: r.bookingCount,
      compare: cmpMap.get(r.day) ?? 0,
    }));
  }, [primary, compare]);

  const primaryTotal = primary.reduce((s, r) => s + r.earnings, 0);
  const compareTotal = compare.reduce((s, r) => s + r.earnings, 0);

  const primaryLabel = `${MONTHS[month - 1]} ${year}`;
  const compareLabel = `${MONTHS[cmpMonth - 1]} ${cmpYear}`;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white">
            Daily Earnings — Month View
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Earnings keyed to booking date (pre-discount). Totals:{" "}
            <span className="font-medium text-emerald-400">
              {formatINR(primaryTotal)}
            </span>
            {compareEnabled && (
              <>
                {" "}
                vs{" "}
                <span className="font-medium text-amber-400">
                  {formatINR(compareTotal)}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <MonthYearSelect
            label="Month"
            month={month}
            year={year}
            years={years}
            onMonth={setMonth}
            onYear={setYear}
          />
          <button
            onClick={() => setCompareEnabled((v) => !v)}
            className={`h-[38px] rounded-lg border px-3 text-xs font-medium transition-colors ${
              compareEnabled
                ? "border-amber-500/30 bg-amber-500/20 text-amber-300"
                : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            }`}
          >
            {compareEnabled ? "Comparing" : "Compare"}
          </button>
          {compareEnabled && (
            <MonthYearSelect
              label="Compare with"
              month={cmpMonth}
              year={cmpYear}
              years={years}
              onMonth={setCmpMonth}
              onYear={setCmpYear}
              accent="amber"
            />
          )}
        </div>
      </div>

      {loading && primary.length === 0 ? (
        <div className="h-72 animate-pulse rounded-lg bg-zinc-800" />
      ) : primary.length === 0 ? (
        <p className="py-12 text-center text-zinc-500">No data for this month</p>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={chartData} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis
              dataKey="day"
              tick={{ fill: "#a1a1aa", fontSize: 11 }}
              interval={0}
            />
            <YAxis
              tick={{ fill: "#a1a1aa", fontSize: 11 }}
              tickFormatter={formatINRShort}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as {
                  day: number;
                  primary: number;
                  primaryBookings: number;
                  compare: number;
                };
                return (
                  <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 shadow-lg">
                    <p className="mb-1 text-xs text-zinc-400">
                      Day {label} · {row.primaryBookings} booking
                      {row.primaryBookings === 1 ? "" : "s"}
                    </p>
                    <p className="text-sm font-medium text-emerald-400">
                      {primaryLabel}: {formatINR(row.primary)}
                    </p>
                    {compareEnabled && (
                      <p className="text-sm font-medium text-amber-400">
                        {compareLabel}: {formatINR(row.compare)}
                      </p>
                    )}
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ color: "#a1a1aa", fontSize: 12 }} />
            <Bar
              dataKey="primary"
              name={primaryLabel}
              fill="#10b981"
              radius={[4, 4, 0, 0]}
            />
            {compareEnabled && (
              <Bar
                dataKey="compare"
                name={compareLabel}
                fill="#f59e0b"
                radius={[4, 4, 0, 0]}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Yearly (month-wise) chart
// ---------------------------------------------------------------------------

interface MonthlyRow {
  month: number;
  earnings: number;
  bookingCount: number;
}

export function MonthlyEarningsChart() {
  const now = new Date();
  const years = useMemo(buildYearOptions, []);

  const [year, setYear] = useState(now.getFullYear());
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [cmpYear, setCmpYear] = useState(now.getFullYear() - 1);

  const [primary, setPrimary] = useState<MonthlyRow[]>([]);
  const [compare, setCompare] = useState<MonthlyRow[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const tasks: Promise<unknown>[] = [getMonthlyEarningsForYear(year)];
      if (compareEnabled) {
        tasks.push(getMonthlyEarningsForYear(cmpYear));
      }
      const [primaryRes, compareRes] = (await Promise.all(tasks)) as [
        Awaited<ReturnType<typeof getMonthlyEarningsForYear>>,
        Awaited<ReturnType<typeof getMonthlyEarningsForYear>> | undefined,
      ];
      if (primaryRes.success) setPrimary(primaryRes.data);
      else setPrimary([]);

      if (compareEnabled && compareRes?.success) setCompare(compareRes.data);
      else setCompare([]);
    } finally {
      setLoading(false);
    }
  }, [year, compareEnabled, cmpYear]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const chartData = useMemo(() => {
    const cmpMap = new Map<number, number>();
    for (const r of compare) cmpMap.set(r.month, r.earnings);
    return primary.map((r) => ({
      month: r.month,
      monthLabel: MONTHS[r.month - 1].slice(0, 3),
      primary: r.earnings,
      primaryBookings: r.bookingCount,
      compare: cmpMap.get(r.month) ?? 0,
    }));
  }, [primary, compare]);

  const primaryTotal = primary.reduce((s, r) => s + r.earnings, 0);
  const compareTotal = compare.reduce((s, r) => s + r.earnings, 0);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white">
            Monthly Earnings — Year View
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Earnings keyed to booking date (pre-discount). Year total:{" "}
            <span className="font-medium text-emerald-400">
              {formatINR(primaryTotal)}
            </span>
            {compareEnabled && (
              <>
                {" "}
                vs{" "}
                <span className="font-medium text-amber-400">
                  {formatINR(compareTotal)}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <YearSelect
            label="Year"
            year={year}
            years={years}
            onYear={setYear}
          />
          <button
            onClick={() => setCompareEnabled((v) => !v)}
            className={`h-[38px] rounded-lg border px-3 text-xs font-medium transition-colors ${
              compareEnabled
                ? "border-amber-500/30 bg-amber-500/20 text-amber-300"
                : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            }`}
          >
            {compareEnabled ? "Comparing" : "Compare"}
          </button>
          {compareEnabled && (
            <YearSelect
              label="Compare with"
              year={cmpYear}
              years={years}
              onYear={setCmpYear}
              accent="amber"
            />
          )}
        </div>
      </div>

      {loading && primary.length === 0 ? (
        <div className="h-72 animate-pulse rounded-lg bg-zinc-800" />
      ) : primary.length === 0 ? (
        <p className="py-12 text-center text-zinc-500">No data for this year</p>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={chartData} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis
              dataKey="monthLabel"
              tick={{ fill: "#a1a1aa", fontSize: 11 }}
            />
            <YAxis
              tick={{ fill: "#a1a1aa", fontSize: 11 }}
              tickFormatter={formatINRShort}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as {
                  month: number;
                  primary: number;
                  primaryBookings: number;
                  compare: number;
                };
                return (
                  <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 shadow-lg">
                    <p className="mb-1 text-xs text-zinc-400">
                      {label} · {row.primaryBookings} booking
                      {row.primaryBookings === 1 ? "" : "s"}
                    </p>
                    <p className="text-sm font-medium text-emerald-400">
                      {year}: {formatINR(row.primary)}
                    </p>
                    {compareEnabled && (
                      <p className="text-sm font-medium text-amber-400">
                        {cmpYear}: {formatINR(row.compare)}
                      </p>
                    )}
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ color: "#a1a1aa", fontSize: 12 }} />
            <Bar
              dataKey="primary"
              name={String(year)}
              fill="#10b981"
              radius={[4, 4, 0, 0]}
            />
            {compareEnabled && (
              <Bar
                dataKey="compare"
                name={String(cmpYear)}
                fill="#f59e0b"
                radius={[4, 4, 0, 0]}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared selectors
// ---------------------------------------------------------------------------

function selectClass(accent: "emerald" | "amber") {
  const ring = accent === "amber" ? "focus:border-amber-500" : "focus:border-emerald-500";
  return `h-[38px] rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-xs text-white ${ring} focus:outline-none`;
}

function MonthYearSelect({
  label,
  month,
  year,
  years,
  onMonth,
  onYear,
  accent = "emerald",
}: {
  label: string;
  month: number;
  year: number;
  years: number[];
  onMonth: (m: number) => void;
  onYear: (y: number) => void;
  accent?: "emerald" | "amber";
}) {
  return (
    <div>
      <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
        {label}
      </label>
      <div className="flex gap-2">
        <select
          value={month}
          onChange={(e) => onMonth(Number(e.target.value))}
          className={selectClass(accent)}
        >
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <select
          value={year}
          onChange={(e) => onYear(Number(e.target.value))}
          className={selectClass(accent)}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function YearSelect({
  label,
  year,
  years,
  onYear,
  accent = "emerald",
}: {
  label: string;
  year: number;
  years: number[];
  onYear: (y: number) => void;
  accent?: "emerald" | "amber";
}) {
  return (
    <div>
      <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
        {label}
      </label>
      <select
        value={year}
        onChange={(e) => onYear(Number(e.target.value))}
        className={selectClass(accent)}
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
}
