import { useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  CalendarDays,
  IndianRupee,
  Layers,
  Receipt,
  TrendingUp,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import {
  BarChart,
  ChartCard,
  CHART_COLORS,
  DonutChart,
  LineChart,
} from "../../components/charts";
import { colors, radius, spacing } from "../../theme";
import { formatRupees } from "../../lib/format";
import {
  adminExpensesApi,
  type AdminExpenseAnalytics,
} from "../../lib/admin-expenses";
import type { AdminExpensesStackParamList } from "../../navigation/types";

type Rt = RouteProp<AdminExpensesStackParamList, "AdminExpenseAnalytics">;

/**
 * Mobile mirror of the web /admin/expenses/analytics dashboard. Full
 * parity: every KPI tile and every chart the web page renders, re-drawn
 * with the RN chart kit (react-native-svg).
 *
 * Web sections, mapped 1:1:
 *   - 3 KPI cards: Total Spent / Entries / Categories
 *   - "Monthly Spend" recharts LineChart      → LineChart
 *   - "By Spent Type" recharts Pie + a table  → DonutChart + CategoryTable
 *   - "Who Spent" recharts Bar                → BarChart
 *   - "Payment Mix" recharts Pie             → DonutChart
 *   - "Top Vendors" / "Top Recipients" tables → CategoryTable
 * Plus three mobile-only secondary tiles (avg/entry, months, top type)
 * that surface the same numbers the venue glances at most.
 *
 * Range chips at top (this month / last month / YTD / all time / custom)
 * drive one /api/mobile/admin/expenses/analytics fetch returning the full
 * payload. All expense money is RUPEES already → formatRupees.
 */
export function AdminExpenseAnalyticsScreen() {
  const route = useRoute<Rt>();
  // RUNNING ⇒ Running Expense Analytics — same dashboard, server-scoped
  // to the running-costs module. Module in the query key keeps the two
  // dashboards' caches apart.
  const moduleParam = route.params?.module;
  const [range, setRange] = useState<RangeKey>("THIS_MONTH");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const { from, to } = useMemo(() => resolveRange(range, customFrom, customTo), [
    range,
    customFrom,
    customTo,
  ]);

  const query = useQuery({
    queryKey: [
      "admin-expense-analytics",
      moduleParam ?? "GENERAL",
      from ?? "ALL",
      to ?? "ALL",
    ],
    queryFn: () =>
      adminExpensesApi.analytics({
        from: from ?? undefined,
        to: to ?? undefined,
        module: moduleParam,
      }),
    refetchOnWindowFocus: false,
  });

  const refreshing =
    (query.isFetching && !query.isLoading) || query.isRefetching;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void query.refetch()}
            tintColor={colors.yellow400}
          />
        }
      >
        {/* Range chips */}
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

        {/* Custom range inputs (visible when CUSTOM selected) */}
        {range === "CUSTOM" ? (
          <View style={styles.customRow}>
            <TextInput
              value={customFrom}
              onChangeText={setCustomFrom}
              placeholder="From YYYY-MM-DD"
              placeholderTextColor={colors.zinc600}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
            <TextInput
              value={customTo}
              onChangeText={setCustomTo}
              placeholder="To YYYY-MM-DD"
              placeholderTextColor={colors.zinc600}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
          </View>
        ) : null}

        {/* Summary tiles + charts */}
        {query.isLoading ? (
          <View style={{ gap: spacing["3"] }}>
            <View style={styles.tileRow}>
              <Skeleton width="48%" height={64} rounded="md" />
              <Skeleton width="48%" height={64} rounded="md" />
            </View>
            <Skeleton width="100%" height={220} rounded="lg" />
            <Skeleton width="100%" height={220} rounded="lg" />
          </View>
        ) : query.isError ? (
          <Pressable
            onPress={() => void query.refetch()}
            style={styles.errorBlock}
          >
            <Text variant="body" color={colors.destructive}>
              Couldn't load analytics. Tap to retry.
            </Text>
            <Text variant="tiny" color={colors.zinc500}>
              {query.error instanceof Error
                ? query.error.message
                : "Unknown error"}
            </Text>
          </Pressable>
        ) : query.data ? (
          <Body data={query.data} showVendor={moduleParam !== "RUNNING"} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Body({
  data,
  showVendor,
}: {
  data: AdminExpenseAnalytics;
  /** RUNNING rows carry no vendor, so its breakdown table is hidden there. */
  showVendor: boolean;
}) {
  const avg =
    data.totalCount > 0 ? Math.round(data.totalAmount / data.totalCount) : 0;
  const topType = data.bySpentType[0];

  // ── Monthly spend → single line ──
  const monthlyLine = useMemo(
    () =>
      data.monthlySeries.map((m) => ({
        x: prettyMonth(m.month),
        y: m.amount,
      })),
    [data.monthlySeries],
  );

  // ── By spent type → donut (amount share) ──
  const spentTypeDonut = useMemo(
    () =>
      data.bySpentType.map((r, i) => ({
        label: r.label,
        value: r.amount,
        color: pickColor(i),
      })),
    [data.bySpentType],
  );

  // ── Who spent → vertical bars (amount) ──
  const whoSpentBars = useMemo(
    () =>
      data.byDoneBy.map((r) => ({
        label: r.label,
        value: r.amount,
        color: CHART_COLORS[2],
      })),
    [data.byDoneBy],
  );

  // ── Payment mix → donut (amount share) ──
  const paymentDonut = useMemo(
    () =>
      data.byPaymentType.map((r, i) => ({
        label: r.label,
        value: r.amount,
        color: PAYMENT_COLORS[r.label] ?? pickColor(i + 2),
      })),
    [data.byPaymentType],
  );

  return (
    <View style={{ gap: spacing["3"] }}>
      {/* ───── KPI tiles ───── */}
      <View style={styles.tileRow}>
        <Tile
          icon={<IndianRupee size={14} color={colors.yellow400} />}
          label="Total spent"
          value={formatRupees(data.totalAmount)}
        />
        <Tile
          icon={<Receipt size={14} color={colors.emerald400} />}
          label="Entries"
          value={data.totalCount.toLocaleString("en-IN")}
        />
      </View>
      <View style={styles.tileRow}>
        <Tile
          icon={<Layers size={14} color={"#fb923c"} />}
          label="Categories"
          value={data.bySpentType.length.toLocaleString("en-IN")}
        />
        <Tile
          icon={<Activity size={14} color={colors.zinc300} />}
          label="Average / entry"
          value={formatRupees(avg)}
        />
      </View>
      <View style={styles.tileRow}>
        <Tile
          icon={<CalendarDays size={14} color={"#a78bfa"} />}
          label="Months covered"
          value={data.monthlySeries.length.toLocaleString("en-IN")}
        />
        <Tile
          icon={<TrendingUp size={14} color={colors.yellow400} />}
          label="Top category"
          value={topType ? formatRupees(topType.amount) : "—"}
          sub={topType?.label}
        />
      </View>

      {/* ───── Monthly spend (line) ───── */}
      <ChartCard title="Monthly Spend" subtitle="Total spent per month">
        {monthlyLine.length === 0 ? (
          <EmptyChart />
        ) : (
          <LineChart
            data={monthlyLine}
            height={220}
            color={colors.emerald400}
            formatY={compactRupees}
          />
        )}
      </ChartCard>

      {/* ───── By spent type (donut) ───── */}
      <ChartCard title="By Spent Type" subtitle="Spend share by category">
        {spentTypeDonut.length === 0 ? (
          <EmptyChart />
        ) : (
          <DonutChart
            data={spentTypeDonut}
            centerLabel="Spent"
            centerValue={compactRupees(
              spentTypeDonut.reduce((s, d) => s + d.value, 0),
            )}
          />
        )}
      </ChartCard>

      {/* ───── Spent type — details (table) ───── */}
      <ChartCard title="Spent Type — Details">
        <CategoryTable rows={data.bySpentType} />
      </ChartCard>

      {/* ───── Who spent (bars) ───── */}
      <ChartCard title="Who Spent" subtitle="Spend by person">
        {whoSpentBars.length === 0 ? (
          <EmptyChart />
        ) : (
          <BarChart data={whoSpentBars} height={200} formatValue={compactRupees} />
        )}
      </ChartCard>

      {/* ───── Payment mix (donut) ───── */}
      <ChartCard title="Payment Mix" subtitle="Spend by payment rail">
        {paymentDonut.length === 0 ? (
          <EmptyChart />
        ) : (
          <DonutChart
            data={paymentDonut}
            centerLabel="Spent"
            centerValue={compactRupees(
              paymentDonut.reduce((s, d) => s + d.value, 0),
            )}
          />
        )}
      </ChartCard>

      {/* ───── Top vendors (table) — GENERAL only, RUNNING has no vendor ───── */}
      {showVendor ? (
        <ChartCard title="Top Vendors">
          <CategoryTable rows={data.byVendor} />
        </ChartCard>
      ) : null}

      {/* ───── Top recipients (table) ───── */}
      <ChartCard title="Top Recipients (By)">
        <CategoryTable rows={data.byToName} />
      </ChartCard>
    </View>
  );
}

function Tile({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <View style={styles.tile}>
      <View style={styles.tileHead}>
        {icon}
        <Text variant="tiny" color={colors.zinc500}>
          {label}
        </Text>
      </View>
      <Text variant="bodyStrong">{value}</Text>
      {sub ? (
        <Text variant="tiny" color={colors.zinc600} numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Mirrors the web CategoryTable: Name / Amount / % of total / # entries.
 */
function CategoryTable({
  rows,
}: {
  rows: { label: string; amount: number; count: number }[];
}) {
  if (rows.length === 0) return <EmptyChart label="No data for this period" />;
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  return (
    <View style={{ gap: spacing["1"] }}>
      <View style={[styles.catRow, styles.catHeadRow]}>
        <Text variant="tiny" color={colors.zinc500} style={styles.catName}>
          Name
        </Text>
        <Text variant="tiny" color={colors.zinc500} style={styles.catAmount}>
          Amount
        </Text>
        <Text variant="tiny" color={colors.zinc500} style={styles.catPct}>
          %
        </Text>
        <Text variant="tiny" color={colors.zinc500} style={styles.catCount}>
          #
        </Text>
      </View>
      {rows.map((r) => (
        <View key={r.label} style={styles.catRow}>
          <Text
            variant="small"
            color={colors.zinc300}
            numberOfLines={1}
            style={styles.catName}
          >
            {r.label}
          </Text>
          <Text
            variant="small"
            color={colors.foreground}
            weight="600"
            style={styles.catAmount}
          >
            {formatRupees(r.amount)}
          </Text>
          <Text variant="tiny" color={colors.zinc400} style={styles.catPct}>
            {total > 0 ? ((r.amount / total) * 100).toFixed(1) : "0"}%
          </Text>
          <Text variant="tiny" color={colors.zinc400} style={styles.catCount}>
            {r.count}
          </Text>
        </View>
      ))}
    </View>
  );
}

function EmptyChart({ label = "No data for this period" }: { label?: string }) {
  return (
    <View style={styles.emptyChart}>
      <Text variant="tiny" color={colors.zinc600}>
        {label}
      </Text>
    </View>
  );
}

type RangeKey = "THIS_MONTH" | "LAST_MONTH" | "YTD" | "ALL_TIME" | "CUSTOM";

const RANGES: { value: RangeKey; label: string }[] = [
  { value: "THIS_MONTH", label: "This month" },
  { value: "LAST_MONTH", label: "Last month" },
  { value: "YTD", label: "YTD" },
  { value: "ALL_TIME", label: "All time" },
  { value: "CUSTOM", label: "Custom" },
];

function resolveRange(
  key: RangeKey,
  customFrom: string,
  customTo: string,
): { from: string | null; to: string | null } {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  switch (key) {
    case "THIS_MONTH":
      return {
        from: ymd(new Date(y, m, 1)),
        to: ymd(new Date(y, m + 1, 0)),
      };
    case "LAST_MONTH":
      return {
        from: ymd(new Date(y, m - 1, 1)),
        to: ymd(new Date(y, m, 0)),
      };
    case "YTD":
      return { from: ymd(new Date(y, 0, 1)), to: ymd(today) };
    case "ALL_TIME":
      return { from: null, to: null };
    case "CUSTOM":
      return {
        from: /^\d{4}-\d{2}-\d{2}$/.test(customFrom) ? customFrom : null,
        to: /^\d{4}-\d{2}-\d{2}$/.test(customTo) ? customTo : null,
      };
  }
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "2026-04" → "Apr '26" — terse so the line-chart x axis stays readable. */
function prettyMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split("-");
  const label = MONTHS[Number(m) - 1] ?? m;
  return `${label} '${y.slice(2)}`;
}

/** ₹1.2k / ₹3.4L style compaction for chart axes — keeps labels short. */
function compactRupees(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `₹${(n / 1e3).toFixed(1)}k`;
  return `₹${Math.round(n)}`;
}

function pickColor(i: number): string {
  return CHART_COLORS[i % CHART_COLORS.length];
}

// Mirror the web's hand-picked payment colors (Cash=amber, Online=blue).
const PAYMENT_COLORS: Record<string, string> = {
  Cash: "#f59e0b",
  Online: "#3b82f6",
};

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["8"],
    gap: spacing["3"],
  },
  chipRow: {
    flexDirection: "row",
    gap: spacing["2"],
    paddingVertical: spacing["1"],
  },
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
  customRow: {
    flexDirection: "row",
    gap: spacing["2"],
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.zinc700,
    borderRadius: 8,
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2.5"],
    color: colors.foreground,
    backgroundColor: colors.zinc900,
    fontSize: 13,
    fontFamily: "Courier",
  },
  tileRow: {
    flexDirection: "row",
    gap: spacing["2"],
  },
  tile: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["3"],
    gap: 6,
  },
  tileHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  emptyChart: {
    height: 120,
    alignItems: "center",
    justifyContent: "center",
  },
  catRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing["1.5"],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.zinc800,
  },
  catHeadRow: { borderBottomColor: colors.zinc700 },
  catName: { flex: 1, paddingRight: spacing["2"] },
  catAmount: { width: 84, textAlign: "right" },
  catPct: { width: 48, textAlign: "right" },
  catCount: { width: 32, textAlign: "right" },
  errorBlock: {
    padding: spacing["4"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.30)",
    backgroundColor: "rgba(239, 68, 68, 0.10)",
    gap: spacing["1"],
  },
});
