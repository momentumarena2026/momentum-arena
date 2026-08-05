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
// "Earnings" here is Booking.totalAmount (post-discount, matching the KPI
// Sports Revenue tile), grouped by Booking.date not payment.confirmedAt —
// admins wanted "what did the court earn on this date" independent of when
// the money settled. See getDailyEarningsForMonth / getMonthlyEarningsForYear
// for the SQL.
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

// Weekday labels — indexed by Date.getDay() (0 = Sunday). Short
// 3-char form is used on the X-axis (under the day number); the
// long form is used in the tooltip header.
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
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
  passCount: number;
  teamCount?: number;
  campCount?: number;
  bookingEarnings?: number;
  passEarnings?: number;
  tournamentEarnings?: number;
  campEarnings?: number;
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
      primaryPasses: r.passCount ?? 0,
      primaryTeams: r.teamCount ?? 0,
      primaryCamps: r.campCount ?? 0,
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
            Earnings keyed to booking date (post-discount). Pass sales count
            on their purchase date; pass-paid bookings at ₹0. Totals:{" "}
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
        <ResponsiveContainer width="100%" height={340}>
          <BarChart
            data={chartData}
            barCategoryGap="20%"
            margin={{ top: 5, right: 5, bottom: 8, left: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            {/* Two-line X-axis tick: day-of-month on top, weekday
                short label (Mon, Tue, …) under it. Weekday is
                computed from the primary month/year — when compare
                is on, the secondary bar's day-of-month aligns to
                the same x tick, so we anchor the weekday to the
                primary month consistently. height=44 reserves room
                for the two lines without clipping. */}
            <XAxis
              dataKey="day"
              interval={0}
              height={44}
              tick={(props) => {
                // Recharts types `x` / `y` as string | number on
                // XAxisTickContentProps; coerce to number for SVG
                // transform. `payload.value` is the bound dataKey
                // value — `day` in our case (1..31).
                const p = props as {
                  x: number | string;
                  y: number | string;
                  payload: { value: number };
                };
                const day = p.payload.value;
                const wd = WEEKDAY_SHORT[
                  new Date(year, month - 1, day).getDay()
                ];
                return (
                  <g transform={`translate(${Number(p.x)},${Number(p.y)})`}>
                    <text
                      x={0}
                      y={0}
                      dy={12}
                      textAnchor="middle"
                      fill="#a1a1aa"
                      fontSize={11}
                    >
                      {day}
                    </text>
                    <text
                      x={0}
                      y={0}
                      dy={26}
                      textAnchor="middle"
                      fill="#71717a"
                      fontSize={9}
                    >
                      {wd}
                    </text>
                  </g>
                );
              }}
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
                  primaryPasses: number;
                  primaryTeams: number;
                  primaryCamps: number;
                  compare: number;
                };
                const weekdayLong = WEEKDAY_LONG[
                  new Date(year, month - 1, row.day).getDay()
                ];
                // Only the streams that actually earned that day, so a
                // plain booking day doesn't read "0 Team Reg · 0 Camp Reg".
                const parts = [
                  [row.primaryBookings, "Booking", "Bookings"],
                  [row.primaryPasses, "Pass", "Passes"],
                  [row.primaryTeams, "Team Reg", "Team Regs"],
                  [row.primaryCamps, "Camp Reg", "Camp Regs"],
                ] as const;
                const breakdown = parts
                  .filter(([n]) => n > 0)
                  .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)
                  .join(" · ");
                return (
                  <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 shadow-lg">
                    <p className="mb-1 text-xs text-zinc-400">
                      Day {label} · {weekdayLong}
                    </p>
                    <p className="mb-1 text-xs text-zinc-300">
                      {breakdown || "No activity"}
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
  passCount: number;
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
      primaryPasses: r.passCount ?? 0,
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
            Earnings keyed to booking date (post-discount). Pass sales count
            on their purchase date; pass-paid bookings at ₹0. Year total:{" "}
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
                  primaryPasses: number;
                  compare: number;
                };
                return (
                  <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 shadow-lg">
                    <p className="mb-1 text-xs text-zinc-400">
                      {label} · {row.primaryBookings} booking
                      {row.primaryBookings === 1 ? "" : "s"}
                      {row.primaryPasses > 0 && (
                        <>
                          {" "}
                          · {row.primaryPasses} pass
                          {row.primaryPasses === 1 ? "" : "es"}
                        </>
                      )}
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

// ---------------------------------------------------------------------------
// Revenue breakdown — the same month, split by where the money came from.
//
// The month chart above answers "how much"; this one answers "from what".
// Four stacked streams (bookings, pass sales, tournament entry fees, camp
// fees) plus a per-day count table, because a ₹16,300 Tuesday made of one
// team registration is a different day from one made of five bookings.
// ---------------------------------------------------------------------------

const STREAMS = [
  { key: "bookingEarnings", label: "Bookings", colour: "#10b981" },
  { key: "passEarnings", label: "Pass sales", colour: "#38bdf8" },
  { key: "tournamentEarnings", label: "Tournament entries", colour: "#fbbf24" },
  { key: "campEarnings", label: "Camp fees", colour: "#a78bfa" },
] as const;

export function RevenueBreakdownChart() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [rows, setRows] = useState<DailyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const years = useMemo(buildYearOptions, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getDailyEarningsForMonth(year, month)
      .then((res) => {
        if (cancelled) return;
        setRows(res.success ? (res.data as DailyRow[]) : []);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [year, month]);

  const totals = useMemo(() => {
    const t = {
      bookingEarnings: 0,
      passEarnings: 0,
      tournamentEarnings: 0,
      campEarnings: 0,
      bookingCount: 0,
      passCount: 0,
      teamCount: 0,
      campCount: 0,
      earnings: 0,
    };
    for (const r of rows) {
      t.bookingEarnings += r.bookingEarnings ?? 0;
      t.passEarnings += r.passEarnings ?? 0;
      t.tournamentEarnings += r.tournamentEarnings ?? 0;
      t.campEarnings += r.campEarnings ?? 0;
      t.bookingCount += r.bookingCount ?? 0;
      t.passCount += r.passCount ?? 0;
      t.teamCount += r.teamCount ?? 0;
      t.campCount += r.campCount ?? 0;
      t.earnings += r.earnings ?? 0;
    }
    return t;
  }, [rows]);

  // Only days that actually earned — a 31-row table of mostly zeroes is
  // noise, and the chart already shows the empty days.
  const activeRows = rows.filter((r) => (r.earnings ?? 0) > 0);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white">
            Revenue Breakdown — Day by Day
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Where each day&apos;s money came from. Bookings are keyed to the
            play date; pass sales, tournament entries and camp fees to the day
            the money arrived. Total:{" "}
            <span className="font-medium text-emerald-400">
              {formatINR(totals.earnings)}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white"
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Stream totals — the headline split for the month. */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {STREAMS.map((s) => {
          const amount = totals[s.key];
          const count =
            s.key === "bookingEarnings"
              ? totals.bookingCount
              : s.key === "passEarnings"
                ? totals.passCount
                : s.key === "tournamentEarnings"
                  ? totals.teamCount
                  : totals.campCount;
          const share = totals.earnings
            ? Math.round((amount / totals.earnings) * 100)
            : 0;
          return (
            <div
              key={s.key}
              className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3"
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: s.colour }}
                />
                <span className="text-[11px] uppercase tracking-wide text-zinc-500">
                  {s.label}
                </span>
              </div>
              <p className="mt-1 text-lg font-bold text-white">
                {formatINR(amount)}
              </p>
              <p className="text-[11px] text-zinc-500">
                {count} · {share}% of month
              </p>
            </div>
          );
        })}
      </div>

      {loading ? (
        <div className="flex h-72 items-center justify-center text-sm text-zinc-500">
          Loading…
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={rows} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis
              dataKey="day"
              stroke="#71717a"
              fontSize={11}
              tickLine={false}
            />
            <YAxis
              stroke="#71717a"
              fontSize={11}
              tickLine={false}
              tickFormatter={formatINRShort}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as DailyRow;
                const weekdayLong =
                  WEEKDAY_LONG[new Date(year, month - 1, row.day).getDay()];
                const lines = [
                  ["Bookings", row.bookingCount, row.bookingEarnings, "#10b981"],
                  ["Pass sales", row.passCount, row.passEarnings, "#38bdf8"],
                  ["Team regs", row.teamCount, row.tournamentEarnings, "#fbbf24"],
                  ["Camp regs", row.campCount, row.campEarnings, "#a78bfa"],
                ] as const;
                return (
                  <div className="min-w-[190px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 shadow-lg">
                    <p className="mb-1.5 text-xs text-zinc-400">
                      Day {label} · {weekdayLong}
                    </p>
                    {lines
                      .filter(([, count]) => (count ?? 0) > 0)
                      .map(([name, count, amount, colour]) => (
                        <div
                          key={name}
                          className="flex items-center justify-between gap-4 text-xs"
                        >
                          <span className="flex items-center gap-1.5 text-zinc-300">
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: colour }}
                            />
                            {count} {name}
                          </span>
                          <span className="font-medium text-white">
                            {formatINR(amount ?? 0)}
                          </span>
                        </div>
                      ))}
                    {(row.earnings ?? 0) === 0 && (
                      <p className="text-xs text-zinc-500">No activity</p>
                    )}
                    <div className="mt-1.5 flex items-center justify-between gap-4 border-t border-zinc-800 pt-1.5 text-xs">
                      <span className="text-zinc-400">Total</span>
                      <span className="font-semibold text-emerald-400">
                        {formatINR(row.earnings ?? 0)}
                      </span>
                    </div>
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ color: "#a1a1aa", fontSize: 12 }} />
            {STREAMS.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                stackId="revenue"
                fill={s.colour}
                radius={i === STREAMS.length - 1 ? [4, 4, 0, 0] : undefined}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}

      {/* The same data as a table — easier to read off exact figures than
          hovering 31 bars one at a time. */}
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-xs">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-500">
              <th className="py-2 pr-3 font-medium">Day</th>
              <th className="py-2 pr-3 text-right font-medium">Bookings</th>
              <th className="py-2 pr-3 text-right font-medium">Passes</th>
              <th className="py-2 pr-3 text-right font-medium">Team regs</th>
              <th className="py-2 pr-3 text-right font-medium">Camp regs</th>
              <th className="py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {activeRows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-zinc-500">
                  No earnings recorded this month.
                </td>
              </tr>
            )}
            {activeRows.map((r) => (
              <tr key={r.day} className="border-b border-zinc-800/60">
                <td className="py-2 pr-3 text-zinc-300">
                  {r.day}{" "}
                  <span className="text-zinc-600">
                    {WEEKDAY_LONG[
                      new Date(year, month - 1, r.day).getDay()
                    ]?.slice(0, 3)}
                  </span>
                </td>
                <td className="py-2 pr-3 text-right text-zinc-400">
                  {r.bookingCount ? (
                    <>
                      {r.bookingCount} ·{" "}
                      <span className="text-zinc-300">
                        {formatINR(r.bookingEarnings ?? 0)}
                      </span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-2 pr-3 text-right text-zinc-400">
                  {r.passCount ? (
                    <>
                      {r.passCount} ·{" "}
                      <span className="text-zinc-300">
                        {formatINR(r.passEarnings ?? 0)}
                      </span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-2 pr-3 text-right text-zinc-400">
                  {r.teamCount ? (
                    <>
                      {r.teamCount} ·{" "}
                      <span className="text-zinc-300">
                        {formatINR(r.tournamentEarnings ?? 0)}
                      </span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-2 pr-3 text-right text-zinc-400">
                  {r.campCount ? (
                    <>
                      {r.campCount} ·{" "}
                      <span className="text-zinc-300">
                        {formatINR(r.campEarnings ?? 0)}
                      </span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-2 text-right font-semibold text-emerald-400">
                  {formatINR(r.earnings ?? 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
