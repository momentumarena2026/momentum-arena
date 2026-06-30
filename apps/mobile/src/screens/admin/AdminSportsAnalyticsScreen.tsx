import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  CalendarDays,
  IndianRupee,
  TrendingUp,
  Users,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import {
  LineChart,
  MultiLineChart,
  BarChart,
  DonutChart,
  ChartCard,
  CHART_COLORS,
} from "../../components/charts";
import { colors, radius, spacing } from "../../theme";
import { formatRupees, formatHourCompact, sportLabel } from "../../lib/format";
import {
  adminAnalyticsApi,
  type SportsAnalyticsResponse,
  type SportsGroupBy,
} from "../../lib/admin-analytics";

/**
 * Read-only sports analytics — mobile mirror of web
 * /admin/analytics/sports, at full parity: every KPI tile plus every
 * chart the web dashboard renders.
 *
 * Range chips (30d / 90d / All) + a Day/Week/Month groupBy toggle drive
 * a single fetch against /api/mobile/admin/analytics/sports, which returns
 * the KPI and ALL chart datasets in one payload. "All" sends no from/to so
 * the route defaults to earliest-confirmed-payment → today (lifetime
 * totals matching /admin/bookings).
 *
 * Charts (recharts on web → RN chart kit here):
 *   - Earnings over time         → LineChart
 *   - Sport earnings breakdown   → DonutChart
 *   - Sport earnings by month    → MultiLineChart
 *   - Daily earnings (month)     → BarChart   (calendar-keyed)
 *   - Monthly earnings (year)    → BarChart   (calendar-keyed)
 *   - Peak booking hours         → BarChart
 *   - Payment methods            → DonutChart
 *   - Top customers              → horizontal BarChart
 *
 * Money is in RUPEES across the payload (route normalizes cafe paise →
 * rupees), so everything renders via formatRupees with no /100.
 */
export function AdminSportsAnalyticsScreen() {
  const [range, setRange] = useState<RangeKey>("ALL");
  const [groupBy, setGroupBy] = useState<SportsGroupBy>("day");
  const { from, to } = useMemo(() => resolveRange(range), [range]);

  const query = useQuery({
    queryKey: ["admin-sports-analytics", from ?? "ALL", to ?? "ALL", groupBy],
    queryFn: () =>
      adminAnalyticsApi.sports({
        from: from ?? undefined,
        to: to ?? undefined,
        groupBy,
      }),
    refetchOnWindowFocus: false,
  });

  const refreshing = (query.isFetching && !query.isLoading) || query.isRefetching;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void query.refetch()}
            tintColor={colors.yellow400}
          />
        }
      >
        {/* Date-range chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {RANGES.map((r) => (
            <Pressable
              key={r.value}
              onPress={() => setRange(r.value)}
              style={[styles.chip, range === r.value && styles.chipActive]}
            >
              <Text
                variant="tiny"
                color={range === r.value ? colors.yellow400 : colors.zinc300}
                weight="600"
              >
                {r.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Group-by toggle — mirrors web's Day / Week / Month control. */}
        <View style={styles.toggleRow}>
          <Text variant="tiny" color={colors.zinc500}>
            Group earnings by
          </Text>
          <View style={styles.toggleGroup}>
            {GROUP_BY_OPTIONS.map((g) => (
              <Pressable
                key={g.value}
                onPress={() => setGroupBy(g.value)}
                style={[
                  styles.toggleBtn,
                  groupBy === g.value && styles.toggleBtnActive,
                ]}
              >
                <Text
                  variant="tiny"
                  color={groupBy === g.value ? colors.emerald400 : colors.zinc400}
                  weight="600"
                >
                  {g.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {query.isLoading ? (
          <LoadingState />
        ) : query.isError ? (
          <Pressable onPress={() => void query.refetch()} style={styles.errorBlock}>
            <Text variant="body" color={colors.destructive}>
              Couldn't load analytics. Tap to retry.
            </Text>
            <Text variant="tiny" color={colors.zinc500}>
              {query.error instanceof Error ? query.error.message : "Unknown error"}
            </Text>
          </Pressable>
        ) : query.data ? (
          <Body data={query.data} groupBy={groupBy} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function LoadingState() {
  return (
    <>
      <View style={styles.tileRow}>
        <Skeleton width="48%" height={64} rounded="lg" />
        <Skeleton width="48%" height={64} rounded="lg" />
      </View>
      <View style={styles.tileRow}>
        <Skeleton width="48%" height={64} rounded="lg" />
        <Skeleton width="48%" height={64} rounded="lg" />
      </View>
      <Skeleton width="100%" height={200} rounded="xl" />
      <Skeleton width="100%" height={200} rounded="xl" />
    </>
  );
}

function Body({
  data,
  groupBy,
}: {
  data: SportsAnalyticsResponse;
  groupBy: SportsGroupBy;
}) {
  const k = data.kpi;

  // ── Earnings over time → LineChart ──
  const revenuePoints = data.revenueOverTime.map((p) => ({
    x: formatPeriodLabel(p.period, groupBy),
    y: p.sportsRevenue,
  }));

  // ── Sport breakdown → DonutChart ──
  const sportDonut = data.sportBreakdown
    .filter((s) => s.revenue > 0)
    .map((s, i) => ({
      label: sportLabel(s.sport),
      value: s.revenue,
      color: sportColor(s.sport, i),
    }));

  // ── Sport revenue by month → MultiLineChart ──
  const sportSeries = data.sportMonthlyLabels.map((sport, i) => ({
    name: sport,
    color: sportColorByLabel(sport, i),
    points: data.sportMonthly.map((row) => ({
      x: formatMonthKey(String(row.period)),
      y: typeof row[sport] === "number" ? (row[sport] as number) : 0,
    })),
  }));

  // ── Daily earnings (calendar month) → BarChart ──
  const dailyBars = data.dailyEarnings.data.map((d) => ({
    label: String(d.day),
    value: d.earnings,
    color: colors.emerald500,
  }));
  const dailyTotal = data.dailyEarnings.data.reduce((s, d) => s + d.earnings, 0);
  const dailyLabel = `${MONTHS[data.dailyEarnings.month - 1]} ${data.dailyEarnings.year}`;

  // ── Monthly earnings (calendar year) → BarChart ──
  const monthlyBars = data.monthlyEarnings.data.map((m) => ({
    label: MONTHS[m.month - 1].slice(0, 3),
    value: m.earnings,
    color: colors.emerald500,
  }));
  const monthlyTotal = data.monthlyEarnings.data.reduce(
    (s, m) => s + m.earnings,
    0,
  );

  // ── Peak hours → BarChart ──
  const peakBars = data.peakHours.map((h) => ({
    label: formatHourCompact(h.hour),
    value: h.bookingCount,
    color: colors.emerald500,
  }));

  // ── Payment methods → DonutChart ──
  const paymentDonut = data.paymentMethods
    .filter((p) => p.amount > 0)
    .map((p, i) => ({
      label: paymentLabel(p.method),
      value: p.amount,
      color: paymentColor(p.method, i),
    }));

  return (
    <>
      {/* ── KPI tiles ── */}
      <View style={styles.tileRow}>
        <Tile
          icon={<IndianRupee size={14} color={colors.yellow400} />}
          label="Total earnings"
          value={formatRupees(k.totalRevenue)}
        />
        <Tile
          icon={<IndianRupee size={14} color={colors.emerald400} />}
          label="Sports earnings"
          value={formatRupees(k.sportsRevenue)}
          valueColor={colors.emerald400}
        />
      </View>
      <View style={styles.tileRow}>
        <Tile
          icon={<Activity size={14} color={colors.emerald400} />}
          label="Total bookings"
          value={k.totalBookings.toLocaleString("en-IN")}
        />
        <Tile
          icon={<TrendingUp size={14} color={"#fb923c"} />}
          label="Avg / booking"
          value={formatRupees(k.avgBookingValue)}
        />
      </View>
      <View style={styles.tileRow}>
        <Tile
          icon={<CalendarDays size={14} color={colors.zinc300} />}
          label="Cancellation rate"
          value={`${k.cancellationRate}%`}
          valueColor={
            k.cancellationRate > 10 ? colors.destructive : colors.emerald400
          }
        />
        <Tile
          icon={<Users size={14} color={"#a78bfa"} />}
          label="Active customers"
          value={k.activeCustomers.toLocaleString("en-IN")}
        />
      </View>

      {/* ── Earnings over time ── */}
      <ChartCard title="Earnings Over Time">
        {revenuePoints.length === 0 ? (
          <EmptyChart text="No earnings data for this period" />
        ) : (
          <LineChart
            data={revenuePoints}
            color={colors.emerald500}
            formatY={formatRupeesShort}
          />
        )}
      </ChartCard>

      {/* ── Sport earnings breakdown ── */}
      <ChartCard title="Sport Earnings Breakdown">
        {sportDonut.length === 0 ? (
          <EmptyChart text="No data" />
        ) : (
          <DonutChart
            data={sportDonut}
            centerLabel="Total"
            centerValue={formatRupeesShort(
              sportDonut.reduce((s, d) => s + d.value, 0),
            )}
          />
        )}
      </ChartCard>

      {/* ── Sport earnings by month ── */}
      <ChartCard
        title="Sport Earnings by Month"
        subtitle="Monthly totals per sport across the selected window"
      >
        {sportSeries.length === 0 || data.sportMonthly.length === 0 ? (
          <EmptyChart text="No data for this period" />
        ) : (
          <MultiLineChart series={sportSeries} formatY={formatRupeesShort} />
        )}
      </ChartCard>

      {/* ── Daily earnings (calendar month) ── */}
      <ChartCard
        title="Daily Earnings — Month View"
        subtitle={`${dailyLabel} · ${formatRupees(dailyTotal)}`}
      >
        {dailyBars.length === 0 ? (
          <EmptyChart text="No data for this month" />
        ) : (
          <BarChart data={dailyBars} formatValue={formatRupeesShort} />
        )}
      </ChartCard>

      {/* ── Monthly earnings (calendar year) ── */}
      <ChartCard
        title="Monthly Earnings — Year View"
        subtitle={`${data.monthlyEarnings.year} · ${formatRupees(monthlyTotal)}`}
      >
        {monthlyBars.length === 0 ? (
          <EmptyChart text="No data for this year" />
        ) : (
          <BarChart data={monthlyBars} formatValue={formatRupeesShort} />
        )}
      </ChartCard>

      {/* ── Peak booking hours ── */}
      <ChartCard title="Peak Booking Hours">
        {peakBars.length === 0 ? (
          <EmptyChart text="No data" />
        ) : (
          <BarChart
            data={peakBars}
            formatValue={(n) => `${n}`}
          />
        )}
      </ChartCard>

      {/* ── Payment methods ── */}
      <ChartCard title="Payment Methods">
        {paymentDonut.length === 0 ? (
          <EmptyChart text="No data" />
        ) : (
          <DonutChart
            data={paymentDonut}
            centerLabel="Total"
            centerValue={formatRupeesShort(
              paymentDonut.reduce((s, d) => s + d.value, 0),
            )}
          />
        )}
      </ChartCard>

      {/* ── Top customers ── */}
      <ChartCard title="Top Customers">
        {data.topCustomers.length === 0 ? (
          <EmptyChart text="No data" />
        ) : (
          <View style={styles.customerList}>
            {data.topCustomers.map((c, i) => (
              <View key={c.userId} style={styles.customerRow}>
                <Text variant="tiny" color={colors.zinc500} style={styles.customerRank}>
                  {i + 1}
                </Text>
                <View style={styles.customerInfo}>
                  <Text variant="small" color={colors.foreground} numberOfLines={1}>
                    {c.name}
                  </Text>
                  {c.email ? (
                    <Text variant="tiny" color={colors.zinc600} numberOfLines={1}>
                      {c.email}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.customerStats}>
                  <Text variant="small" color={colors.emerald400} weight="600">
                    {formatRupees(c.totalSpent)}
                  </Text>
                  <Text variant="tiny" color={colors.zinc500}>
                    {c.bookingCount} booking{c.bookingCount === 1 ? "" : "s"}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ChartCard>

      <Text variant="tiny" color={colors.zinc600} style={styles.rangeNote}>
        {data.range.from} → {data.range.to}
      </Text>
    </>
  );
}

// ─────────── Small pieces ───────────

function Tile({
  icon,
  label,
  value,
  valueColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <View style={styles.tile}>
      <View style={styles.tileHead}>
        {icon}
        <Text variant="tiny" color={colors.zinc500}>
          {label}
        </Text>
      </View>
      <Text variant="bodyStrong" color={valueColor}>
        {value}
      </Text>
    </View>
  );
}

function EmptyChart({ text }: { text: string }) {
  return (
    <View style={styles.emptyChart}>
      <Text variant="small" color={colors.zinc500}>
        {text}
      </Text>
    </View>
  );
}

// ─────────── Formatting / color helpers ───────────

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

/** ₹1.2L / ₹45.6k / ₹900 — keeps axis labels terse (mirror of web). */
function formatRupeesShort(rupees: number): string {
  if (rupees >= 100000) return `₹${(rupees / 100000).toFixed(1)}L`;
  if (rupees >= 1000) return `₹${(rupees / 1000).toFixed(1)}k`;
  return `₹${Math.round(rupees)}`;
}

/** "2026-03-14" → "14/3" for day/week; passthrough month key otherwise. */
function formatPeriodLabel(period: string, groupBy: SportsGroupBy): string {
  if (groupBy === "month") return formatMonthKey(period);
  const d = new Date(period);
  if (Number.isNaN(d.getTime())) return period;
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

/** "2026-03" or "2026-03-01" → "Mar 26". */
function formatMonthKey(key: string): string {
  const parts = key.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  if (!y || !m) return key;
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleDateString("en-IN", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

// Sport palette — mirror of web's SPORT_COLORS, keyed on the uppercase
// enum. Falls back to the rotating CHART_COLORS for unknown sports.
const SPORT_PALETTE: Record<string, string> = {
  CRICKET: "#10b981",
  FOOTBALL: "#3b82f6",
  PICKLEBALL: "#f59e0b",
};

function sportColor(sportEnum: string, index: number): string {
  return SPORT_PALETTE[sportEnum] ?? CHART_COLORS[index % CHART_COLORS.length];
}

// The monthly series labels come back title-cased (e.g. "Cricket"), so
// resolve by uppercasing back to the enum key.
function sportColorByLabel(label: string, index: number): string {
  return (
    SPORT_PALETTE[label.toUpperCase()] ??
    CHART_COLORS[index % CHART_COLORS.length]
  );
}

// Payment palette — mirror of web's PAYMENT_COLORS.
const PAYMENT_PALETTE: Record<string, string> = {
  RAZORPAY: "#3b82f6",
  UPI_QR: "#10b981",
  UPI: "#10b981",
  CASH: "#f59e0b",
  FREE: "#6b7280",
};

function paymentColor(method: string, index: number): string {
  return (
    PAYMENT_PALETTE[method.toUpperCase()] ??
    CHART_COLORS[index % CHART_COLORS.length]
  );
}

function paymentLabel(method: string): string {
  if (method === "UPI_QR" || method === "UPI") return "UPI";
  return method.charAt(0).toUpperCase() + method.slice(1).toLowerCase();
}

// ─────────── Range control ───────────

type RangeKey = "30D" | "90D" | "ALL";

const RANGES: { value: RangeKey; label: string }[] = [
  { value: "30D", label: "30 days" },
  { value: "90D", label: "90 days" },
  { value: "ALL", label: "All time" },
];

const GROUP_BY_OPTIONS: { value: SportsGroupBy; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

function resolveRange(key: RangeKey): { from: string | null; to: string | null } {
  if (key === "ALL") return { from: null, to: null };
  const days = key === "30D" ? 30 : 90;
  const today = new Date();
  const from = new Date(today.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: ymd(from), to: ymd(today) };
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["8"],
    gap: spacing["3"],
  },
  chipRow: { flexDirection: "row", gap: spacing["2"], paddingVertical: spacing["1"] },
  chip: {
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["1.5"],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  chipActive: {
    borderColor: "rgba(250, 204, 21, 0.40)",
    backgroundColor: "rgba(250, 204, 21, 0.10)",
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  toggleGroup: {
    flexDirection: "row",
    gap: spacing["1"],
  },
  toggleBtn: {
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["1.5"],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  toggleBtnActive: {
    borderColor: colors.emerald500_30,
    backgroundColor: colors.emerald500_20,
  },
  tileRow: { flexDirection: "row", gap: spacing["2"] },
  tile: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["3"],
    gap: 6,
  },
  tileHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  emptyChart: {
    paddingVertical: spacing["10"],
    alignItems: "center",
    justifyContent: "center",
  },
  customerList: { gap: spacing["2.5"] },
  customerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
  },
  customerRank: { width: 16, textAlign: "center" },
  customerInfo: { flex: 1, gap: 2 },
  customerStats: { alignItems: "flex-end", gap: 2 },
  rangeNote: { textAlign: "center", marginTop: spacing["1"] },
  errorBlock: {
    padding: spacing["4"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.30)",
    backgroundColor: "rgba(239, 68, 68, 0.10)",
    gap: spacing["1"],
  },
});
