import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Coffee,
  IndianRupee,
  Percent,
  ShoppingBag,
  TrendingUp,
  Users,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import { formatRupees } from "../../lib/format";
import {
  adminAnalyticsApi,
  type CafeAnalyticsResponse,
} from "../../lib/admin-analytics";

/**
 * Read-only cafe analytics — mobile mirror of web
 * /admin/analytics/cafe. Range chips (30d / 90d / All) drive a
 * getCafeKPIStats fetch; "All" sends no from/to so the route defaults
 * to earliest-cafe-order → today (lifetime totals).
 *
 * KPIs: revenue, profit, margin, orders, items sold, avg order value,
 * discount, unique customers. One revenue / cost / profit breakdown
 * bar. All cafe money is RUPEES already.
 */
export function AdminCafeAnalyticsScreen() {
  const [range, setRange] = useState<RangeKey>("ALL");
  const { from, to } = useMemo(() => resolveRange(range), [range]);

  const query = useQuery({
    queryKey: ["admin-cafe-analytics", from ?? "ALL", to ?? "ALL"],
    queryFn: () =>
      adminAnalyticsApi.cafe({ from: from ?? undefined, to: to ?? undefined }),
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

        {query.isLoading ? (
          <View style={styles.tileRow}>
            <Skeleton width="48%" height={64} rounded="md" />
            <Skeleton width="48%" height={64} rounded="md" />
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
          <Body data={query.data} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Body({ data }: { data: CafeAnalyticsResponse }) {
  const k = data.kpi;
  const splitMax = Math.max(k.totalRevenue, k.totalCost, k.totalProfit, 1);

  return (
    <>
      <View style={styles.tileRow}>
        <Tile
          icon={<IndianRupee size={14} color={colors.yellow400} />}
          label="Revenue"
          value={formatRupees(k.totalRevenue)}
        />
        <Tile
          icon={<TrendingUp size={14} color={colors.emerald400} />}
          label="Profit"
          value={formatRupees(k.totalProfit)}
        />
      </View>
      <View style={styles.tileRow}>
        <Tile
          icon={<Percent size={14} color={"#fb923c"} />}
          label="Margin"
          value={`${k.profitMargin}%`}
        />
        <Tile
          icon={<ShoppingBag size={14} color={colors.zinc300} />}
          label="Orders"
          value={k.totalOrders.toLocaleString("en-IN")}
        />
      </View>
      <View style={styles.tileRow}>
        <Tile
          icon={<Coffee size={14} color={"#a78bfa"} />}
          label="Items sold"
          value={k.totalItemsSold.toLocaleString("en-IN")}
        />
        <Tile
          icon={<IndianRupee size={14} color={colors.emerald400} />}
          label="Avg order"
          value={formatRupees(k.avgOrderValue)}
        />
      </View>
      <View style={styles.tileRow}>
        <Tile
          icon={<Users size={14} color={colors.yellow400} />}
          label="Customers"
          value={k.uniqueCustomers.toLocaleString("en-IN")}
        />
        <Tile
          icon={<IndianRupee size={14} color={"#fb923c"} />}
          label="Discount given"
          value={formatRupees(k.discountGiven)}
        />
      </View>

      <Section title="REVENUE / COST / PROFIT">
        <BarRow label="Revenue" amount={k.totalRevenue} max={splitMax} color={colors.yellow400} />
        <BarRow label="Cost" amount={k.totalCost} max={splitMax} color={colors.destructive} />
        <BarRow label="Profit" amount={k.totalProfit} max={splitMax} color={colors.emerald400} />
      </Section>

      {k.refundsDue > 0 ? (
        <View style={styles.noteBlock}>
          <Text variant="tiny" color={"#fb923c"} weight="600">
            {k.refundsDue} cancelled order{k.refundsDue === 1 ? "" : "s"} with a completed payment (refunds due)
          </Text>
        </View>
      ) : null}

      <Text variant="tiny" color={colors.zinc600} style={styles.rangeNote}>
        {data.range.from} → {data.range.to}
      </Text>
    </>
  );
}

function Tile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
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
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <BarChart3 size={12} color={colors.zinc500} />
        <Text variant="tiny" color={colors.zinc500} style={styles.sectionTitle}>
          {title}
        </Text>
      </View>
      <View style={{ gap: spacing["1.5"] }}>{children}</View>
    </View>
  );
}

function BarRow({
  label,
  amount,
  max,
  color,
}: {
  label: string;
  amount: number;
  max: number;
  color: string;
}) {
  // Clamp negative profit to a zero-width bar so the track never
  // renders an inverted fill.
  const widthPct = max > 0 ? Math.max(0, (amount / max) * 100) : 0;
  return (
    <View style={styles.barRow}>
      <View style={styles.barHead}>
        <Text variant="tiny" color={colors.zinc300} numberOfLines={1} style={{ flex: 1 }}>
          {label}
        </Text>
        <Text variant="tiny" color={colors.foreground} weight="600">
          {formatRupees(amount)}
        </Text>
      </View>
      <View style={styles.barTrack}>
        <View
          style={[styles.barFill, { width: `${widthPct}%`, backgroundColor: color, opacity: 0.45 }]}
        />
      </View>
    </View>
  );
}

type RangeKey = "30D" | "90D" | "ALL";

const RANGES: { value: RangeKey; label: string }[] = [
  { value: "30D", label: "30 days" },
  { value: "90D", label: "90 days" },
  { value: "ALL", label: "All time" },
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
  section: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["4"],
    gap: spacing["2"],
  },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: spacing["1.5"] },
  sectionTitle: { letterSpacing: 1.5, fontWeight: "700" },
  barRow: { gap: 4 },
  barHead: { flexDirection: "row", alignItems: "center", gap: spacing["2"] },
  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.zinc800,
    overflow: "hidden",
  },
  barFill: { height: 6, borderRadius: 3 },
  noteBlock: {
    padding: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(251, 146, 60, 0.30)",
    backgroundColor: "rgba(251, 146, 60, 0.10)",
  },
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
