import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Coffee,
  IndianRupee,
  Percent,
  Receipt,
  RotateCcw,
  ShoppingBag,
  TrendingUp,
  Users,
  XCircle,
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
  MultiLineChart,
} from "../../components/charts";
import { colors, radius, spacing } from "../../theme";
import { formatRupees, formatHourCompact } from "../../lib/format";
import {
  adminCafeAnalyticsApi,
  type CafeAnalyticsResponse,
  type CafeGroupBy,
  type CafeItemInventoryRow,
} from "../../lib/admin-cafe-analytics";

/**
 * Read-only Cafe Analytics — mobile mirror of the web
 * /admin/analytics/cafe dashboard. Full parity: every KPI stat card and
 * every chart the web page renders, re-drawn with the RN chart kit.
 *
 * Range chips (30d / 90d / All) + a day/week/month group-by control
 * drive a single /api/mobile/admin/analytics/cafe fetch that returns the
 * whole payload (KPIs + all chart datasets + an inventory page). "All"
 * sends no from/to so the route defaults to earliest-cafe-order → today
 * (lifetime totals). All cafe money is RUPEES already.
 */
export function AdminCafeAnalyticsScreen() {
  const [range, setRange] = useState<RangeKey>("ALL");
  const [groupBy, setGroupBy] = useState<CafeGroupBy>("day");
  const { from, to } = useMemo(() => resolveRange(range), [range]);

  const query = useQuery({
    queryKey: ["admin-cafe-analytics", from ?? "ALL", to ?? "ALL", groupBy],
    queryFn: () =>
      adminCafeAnalyticsApi.get({
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

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {GROUP_BYS.map((g) => (
            <Pressable
              key={g.value}
              onPress={() => setGroupBy(g.value)}
              style={[styles.chip, groupBy === g.value && styles.chipActive]}
            >
              <Text
                variant="tiny"
                color={groupBy === g.value ? colors.yellow400 : colors.zinc300}
                weight="600"
              >
                {g.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

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

function Body({
  data,
  groupBy,
}: {
  data: CafeAnalyticsResponse;
  groupBy: CafeGroupBy;
}) {
  const k = data.kpi;

  const profitColor = k.totalProfit < 0 ? colors.destructive : colors.emerald400;
  const cancelColor =
    k.cancellationRate > 10 ? colors.destructive : colors.emerald400;

  // ── Revenue / Profit / Cost over time → multi-line ──
  const revSeries = useMemo(
    () => [
      {
        name: "Revenue",
        color: CHART_COLORS[0],
        points: data.revenueOverTime.map((b) => ({
          x: bucketLabel(b.period, groupBy),
          y: b.revenue,
        })),
      },
      {
        name: "Profit",
        color: CHART_COLORS[1],
        points: data.revenueOverTime.map((b) => ({
          x: bucketLabel(b.period, groupBy),
          y: b.profit,
        })),
      },
      {
        name: "Cost",
        color: CHART_COLORS[2],
        points: data.revenueOverTime.map((b) => ({
          x: bucketLabel(b.period, groupBy),
          y: b.cost,
        })),
      },
    ],
    [data.revenueOverTime, groupBy],
  );

  // ── Orders over time → single line ──
  const ordersSeries = useMemo(
    () =>
      data.revenueOverTime.map((b) => ({
        x: bucketLabel(b.period, groupBy),
        y: b.orders,
      })),
    [data.revenueOverTime, groupBy],
  );

  // ── Category breakdown → donut (revenue) ──
  const categoryDonut = data.categoryBreakdown.map((c, i) => ({
    label: titleCase(c.category),
    value: c.revenue,
    color: CATEGORY_COLORS[c.category] ?? pickColor(i),
  }));

  // ── Category revenue + profit → grouped bars (revenue) ──
  const categoryRevBars = data.categoryBreakdown.map((c, i) => ({
    label: titleCase(c.category),
    value: c.revenue,
    color: CATEGORY_COLORS[c.category] ?? pickColor(i),
  }));

  // ── Top items → horizontal bar (revenue) ──
  const topItemsBars = data.topItems.map((it, i) => ({
    label: it.itemName,
    value: it.revenue,
    color: pickColor(i),
  }));

  // ── Payment methods → donut ──
  const paymentDonut = data.paymentMethods.map((p, i) => ({
    label: p.method === "UPI_QR" ? "UPI" : titleCase(p.method),
    value: p.amount,
    color: PAYMENT_COLORS[p.method] ?? pickColor(i),
  }));

  // ── Peak hours → bar (orders) ──
  const peakHoursBars = data.peakHours
    .filter((h) => h.orderCount > 0)
    .map((h) => ({
      label: formatHourCompact(h.hour),
      value: h.orderCount,
      color: colors.warning,
    }));

  // ── Status mix → bar (orders) ──
  const statusBars = data.statusBreakdown.map((s) => ({
    label: titleCase(s.status),
    value: s.count,
    color: STATUS_COLORS[s.status] ?? colors.zinc500,
  }));

  // ── Veg vs Non-Veg → donut (revenue) ──
  const vegDonut = data.vegBreakdown
    .filter((v) => v.revenue > 0)
    .map((v) => ({
      label: v.type,
      value: v.revenue,
      color: v.type === "Veg" ? colors.emerald500 : colors.destructive,
    }));

  // ── Ready vs Kitchen → donut (revenue) ──
  const fulfilmentDonut = data.fulfilmentBreakdown
    .filter((f) => f.revenue > 0)
    .map((f) => ({
      label: f.fulfilment,
      value: f.revenue,
      color: f.fulfilment === "Ready" ? colors.emerald500 : colors.warning,
    }));

  // ── Day of week → bar (orders) ──
  const dowBars = data.dayOfWeekBreakdown.map((d) => ({
    label: d.day,
    value: d.orderCount,
    color: CHART_COLORS[4 % CHART_COLORS.length],
  }));

  const totalRevenueForPct = data.paymentMethods.reduce(
    (s, p) => s + p.amount,
    0,
  );

  return (
    <View style={{ gap: spacing["3"] }}>
      {/* ───── KPI stat cards ───── */}
      <View style={styles.tileRow}>
        <Tile
          icon={<IndianRupee size={14} color={colors.yellow400} />}
          label="Revenue"
          value={formatRupees(k.totalRevenue)}
        />
        <Tile
          icon={<TrendingUp size={14} color={profitColor} />}
          label="Profit"
          value={formatRupees(k.totalProfit)}
          valueColor={profitColor}
          sub={`${k.profitMargin}% margin`}
        />
      </View>
      <View style={styles.tileRow}>
        <Tile
          icon={<Receipt size={14} color={colors.warning} />}
          label="Cost of goods"
          value={formatRupees(k.totalCost)}
          sub={k.totalCost === 0 ? "Set cost prices" : undefined}
        />
        <Tile
          icon={<Percent size={14} color={"#fb923c"} />}
          label="Margin"
          value={`${k.profitMargin}%`}
        />
      </View>
      <View style={styles.tileRow}>
        <Tile
          icon={<ShoppingBag size={14} color={colors.zinc300} />}
          label="Orders"
          value={k.totalOrders.toLocaleString("en-IN")}
        />
        <Tile
          icon={<Coffee size={14} color={"#a78bfa"} />}
          label="Items sold"
          value={k.totalItemsSold.toLocaleString("en-IN")}
        />
      </View>
      <View style={styles.tileRow}>
        <Tile
          icon={<IndianRupee size={14} color={colors.emerald400} />}
          label="Avg order value"
          value={formatRupees(k.avgOrderValue)}
        />
        <Tile
          icon={<XCircle size={14} color={cancelColor} />}
          label="Cancellation"
          value={`${k.cancellationRate}%`}
          valueColor={cancelColor}
        />
      </View>
      <View style={styles.tileRow}>
        <Tile
          icon={<IndianRupee size={14} color={"#c084fc"} />}
          label="Discount given"
          value={formatRupees(k.discountGiven)}
        />
        <Tile
          icon={<Users size={14} color={colors.yellow400} />}
          label="Unique customers"
          value={k.uniqueCustomers.toLocaleString("en-IN")}
        />
      </View>
      <View style={styles.tileRow}>
        <Tile
          icon={
            <RotateCcw
              size={14}
              color={k.refundsDue > 0 ? colors.destructive : colors.zinc500}
            />
          }
          label="Refunds due"
          value={k.refundsDue.toLocaleString("en-IN")}
          valueColor={k.refundsDue > 0 ? colors.destructive : colors.zinc400}
          sub={k.refundsDue > 0 ? "Cancelled w/ payment" : undefined}
        />
        <View style={styles.tileSpacer} />
      </View>

      {/* ───── Revenue / Profit / Cost over time ───── */}
      <ChartCard
        title="Revenue, Profit & Cost"
        subtitle={`Over time · grouped by ${groupBy}`}
      >
        {data.revenueOverTime.length === 0 ? (
          <EmptyChart />
        ) : (
          <MultiLineChart
            series={revSeries}
            height={220}
            formatY={(n) => compactRupees(n)}
          />
        )}
      </ChartCard>

      {/* ───── Orders over time ───── */}
      <ChartCard title="Orders" subtitle={`Over time · grouped by ${groupBy}`}>
        {ordersSeries.length === 0 ? (
          <EmptyChart />
        ) : (
          <LineChart
            data={ordersSeries}
            height={180}
            color={"#8b5cf6"}
            formatY={(n) => String(Math.round(n))}
          />
        )}
      </ChartCard>

      {/* ───── Category breakdown (donut) ───── */}
      <ChartCard title="By Category" subtitle="Revenue share">
        {categoryDonut.length === 0 ? (
          <EmptyChart />
        ) : (
          <DonutChart
            data={categoryDonut}
            centerLabel="Revenue"
            centerValue={compactRupees(
              categoryDonut.reduce((s, d) => s + d.value, 0),
            )}
          />
        )}
      </ChartCard>

      {/* ───── Category revenue (bars) ───── */}
      <ChartCard title="Category Revenue" subtitle="By menu category">
        {categoryRevBars.length === 0 ? (
          <EmptyChart />
        ) : (
          <BarChart
            data={categoryRevBars}
            height={200}
            formatValue={(n) => compactRupees(n)}
          />
        )}
      </ChartCard>

      {/* ───── Top items (horizontal bars) ───── */}
      <ChartCard title="Top 10 Items" subtitle="By revenue">
        {topItemsBars.length === 0 ? (
          <EmptyChart />
        ) : (
          <BarChart
            data={topItemsBars}
            horizontal
            formatValue={(n) => compactRupees(n)}
          />
        )}
      </ChartCard>

      {/* ───── Payment methods (donut) ───── */}
      <ChartCard title="Payment Methods" subtitle="By amount collected">
        {paymentDonut.length === 0 ? (
          <EmptyChart />
        ) : (
          <DonutChart
            data={paymentDonut}
            centerLabel="Collected"
            centerValue={compactRupees(totalRevenueForPct)}
          />
        )}
      </ChartCard>

      {/* ───── Peak hours (bars) ───── */}
      <ChartCard title="Peak Order Hours" subtitle="Orders by hour of day">
        {peakHoursBars.length === 0 ? (
          <EmptyChart />
        ) : (
          <BarChart
            data={peakHoursBars}
            height={200}
            formatValue={(n) => `${Math.round(n)}`}
          />
        )}
      </ChartCard>

      {/* ───── Day of week (bars) ───── */}
      <ChartCard title="Orders by Day of Week">
        {dowBars.length === 0 ? (
          <EmptyChart />
        ) : (
          <BarChart
            data={dowBars}
            height={180}
            formatValue={(n) => `${Math.round(n)}`}
          />
        )}
      </ChartCard>

      {/* ───── Status mix (bars) ───── */}
      <ChartCard title="Order Status Mix" subtitle="Orders by status">
        {statusBars.length === 0 ? (
          <EmptyChart />
        ) : (
          <BarChart
            data={statusBars}
            height={180}
            formatValue={(n) => `${Math.round(n)}`}
          />
        )}
      </ChartCard>

      {/* ───── Veg vs Non-Veg (donut) ───── */}
      <ChartCard title="Veg vs Non-Veg" subtitle="Revenue share">
        {vegDonut.length === 0 ? (
          <EmptyChart />
        ) : (
          <DonutChart data={vegDonut} />
        )}
      </ChartCard>

      {/* ───── Ready vs Kitchen (donut) ───── */}
      <ChartCard title="Ready vs Kitchen" subtitle="Fulfilment revenue share">
        {fulfilmentDonut.length === 0 ? (
          <EmptyChart />
        ) : (
          <DonutChart data={fulfilmentDonut} />
        )}
      </ChartCard>

      {/* ───── Top customers (list) ───── */}
      <ChartCard title="Top Customers" subtitle="By total spend">
        {data.topCustomers.length === 0 ? (
          <EmptyChart label="No customers" />
        ) : (
          <View style={{ gap: spacing["2"] }}>
            {data.topCustomers.map((c, i) => (
              <View key={c.userId} style={styles.custRow}>
                <Text variant="tiny" color={colors.zinc500} style={styles.custRank}>
                  {i + 1}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {c.name}
                  </Text>
                  {c.email ? (
                    <Text variant="tiny" color={colors.zinc500} numberOfLines={1}>
                      {c.email}
                    </Text>
                  ) : null}
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text variant="bodyStrong" color={colors.emerald400}>
                    {formatRupees(c.totalSpent)}
                  </Text>
                  <Text variant="tiny" color={colors.zinc500}>
                    {c.orderCount} order{c.orderCount === 1 ? "" : "s"}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ChartCard>

      {/* ───── Inventory & sales table ───── */}
      <ChartCard
        title="Item Inventory & Sales"
        subtitle={`Top ${data.inventory.rows.length} of ${data.inventory.total} items · by units sold`}
      >
        {data.inventory.rows.length === 0 ? (
          <EmptyChart label="No items" />
        ) : (
          <View style={{ gap: spacing["1"] }}>
            <View style={[styles.invRow, styles.invHeadRow]}>
              <Text variant="tiny" color={colors.zinc500} style={styles.invName}>
                Item
              </Text>
              <Text variant="tiny" color={colors.zinc500} style={styles.invNum}>
                Sold
              </Text>
              <Text variant="tiny" color={colors.zinc500} style={styles.invNum}>
                Stock
              </Text>
            </View>
            {data.inventory.rows.map((r) => (
              <InventoryRow key={r.id} row={r} />
            ))}
          </View>
        )}
      </ChartCard>

      {k.refundsDue > 0 ? (
        <View style={styles.noteBlock}>
          <View style={styles.noteHead}>
            <AlertTriangle size={14} color={"#fb923c"} />
            <Text variant="tiny" color={"#fb923c"} weight="600">
              {k.refundsDue} cancelled order{k.refundsDue === 1 ? "" : "s"} with a
              completed payment (refunds due)
            </Text>
          </View>
        </View>
      ) : null}

      <Text variant="tiny" color={colors.zinc600} style={styles.rangeNote}>
        {data.range.from} → {data.range.to}
      </Text>
    </View>
  );
}

function InventoryRow({ row }: { row: CafeItemInventoryRow }) {
  const stock = row.stockLeft;
  const stockNode =
    stock === null ? (
      <Text variant="tiny" color={colors.zinc600} style={styles.invNum}>
        —
      </Text>
    ) : stock === 0 ? (
      <Text variant="tiny" color={colors.destructive} weight="600" style={styles.invNum}>
        Out
      </Text>
    ) : stock <= 3 ? (
      <Text variant="tiny" color={colors.yellow300} weight="600" style={styles.invNum}>
        {stock}
      </Text>
    ) : (
      <Text variant="tiny" color={colors.zinc300} style={styles.invNum}>
        {stock.toLocaleString("en-IN")}
      </Text>
    );

  return (
    <View style={styles.invRow}>
      <View style={styles.invName}>
        <Text variant="small" color={colors.foreground} numberOfLines={1}>
          {row.name}
        </Text>
        <Text variant="tiny" color={colors.zinc600}>
          {titleCase(row.category)}
        </Text>
      </View>
      <Text variant="small" color={colors.emerald400} weight="600" style={styles.invNum}>
        {row.unitsSold.toLocaleString("en-IN")}
      </Text>
      {stockNode}
    </View>
  );
}

function Tile({
  icon,
  label,
  value,
  valueColor,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueColor?: string;
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
      <Text variant="bodyStrong" color={valueColor}>
        {value}
      </Text>
      {sub ? (
        <Text variant="tiny" color={colors.zinc600}>
          {sub}
        </Text>
      ) : null}
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

// ─────────── Range / group-by controls ───────────

type RangeKey = "30D" | "90D" | "ALL";

const RANGES: { value: RangeKey; label: string }[] = [
  { value: "30D", label: "30 days" },
  { value: "90D", label: "90 days" },
  { value: "ALL", label: "All time" },
];

const GROUP_BYS: { value: CafeGroupBy; label: string }[] = [
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
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

// ─────────── Formatting helpers ───────────

/** Compact a bucket period (YYYY-MM-DD or YYYY-MM) into a short x label. */
function bucketLabel(period: string, groupBy: CafeGroupBy): string {
  if (groupBy === "month") {
    // YYYY-MM → "Mon 'YY" style would need a parse; keep it terse.
    const [, m] = period.split("-");
    const monthIdx = Number(m) - 1;
    return MONTHS[monthIdx] ?? period;
  }
  // day / week anchor on a real date — show D/M.
  const parts = period.split("-");
  if (parts.length === 3) return `${Number(parts[2])}/${Number(parts[1])}`;
  return period;
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

/** ₹1.2k / ₹3.4L style compaction for chart axes — keeps labels short. */
function compactRupees(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `₹${(n / 1e3).toFixed(1)}k`;
  return `₹${Math.round(n)}`;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function pickColor(i: number): string {
  return CHART_COLORS[i % CHART_COLORS.length];
}

// Web color palettes mirrored so categories/payments/statuses read the
// same across platforms.
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
  tileSpacer: { flex: 1 },
  tileHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  emptyChart: {
    height: 120,
    alignItems: "center",
    justifyContent: "center",
  },
  custRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2.5"],
    paddingVertical: spacing["1.5"],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.zinc800,
  },
  custRank: { width: 18, textAlign: "center" },
  invRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing["1.5"],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.zinc800,
  },
  invHeadRow: { borderBottomColor: colors.zinc700 },
  invName: { flex: 1, paddingRight: spacing["2"] },
  invNum: { width: 56, textAlign: "right" },
  noteBlock: {
    padding: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(251, 146, 60, 0.30)",
    backgroundColor: "rgba(251, 146, 60, 0.10)",
  },
  noteHead: { flexDirection: "row", alignItems: "center", gap: spacing["2"] },
  rangeNote: { textAlign: "center" },
  errorBlock: {
    padding: spacing["4"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.30)",
    backgroundColor: "rgba(239, 68, 68, 0.10)",
    gap: spacing["1"],
  },
});
