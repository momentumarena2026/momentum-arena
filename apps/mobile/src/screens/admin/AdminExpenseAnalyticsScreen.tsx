import { useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  BarChart3,
  CalendarDays,
  IndianRupee,
  TrendingUp,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminExpensesApi,
  type AdminExpenseAnalytics,
} from "../../lib/admin-expenses";

/**
 * Mirrors the web /admin/expenses/analytics page on a single mobile
 * scroll view. Range chips at top (this month / last month / YTD /
 * all time), summary tiles, monthly bar list, and four breakdown
 * tables (spent type, vendor, paid to, payment type).
 *
 * Charts on the web use recharts; on mobile we render compact
 * horizontal bars built from `View`s — keeps the bundle size down
 * (no extra chart lib) and renders fine for the 5–15 row breakdowns
 * the venue actually has.
 */
export function AdminExpenseAnalyticsScreen() {
  const [range, setRange] = useState<RangeKey>("THIS_MONTH");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const { from, to } = useMemo(() => resolveRange(range, customFrom, customTo), [
    range,
    customFrom,
    customTo,
  ]);

  const query = useQuery({
    queryKey: ["admin-expense-analytics", from ?? "ALL", to ?? "ALL"],
    queryFn: () =>
      adminExpensesApi.analytics({
        from: from ?? undefined,
        to: to ?? undefined,
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

        {/* Summary tiles */}
        {query.isLoading ? (
          <View style={styles.tileRow}>
            <Skeleton width="48%" height={64} rounded="md" />
            <Skeleton width="48%" height={64} rounded="md" />
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
          <Body data={query.data} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Body({ data }: { data: AdminExpenseAnalytics }) {
  const avg =
    data.totalCount > 0 ? Math.round(data.totalAmount / data.totalCount) : 0;

  return (
    <>
      <View style={styles.tileRow}>
        <Tile
          icon={<IndianRupee size={14} color={colors.yellow400} />}
          label="Total spent"
          value={formatINR(data.totalAmount)}
        />
        <Tile
          icon={<Activity size={14} color={colors.emerald400} />}
          label="Entries"
          value={data.totalCount.toString()}
        />
      </View>
      <View style={styles.tileRow}>
        <Tile
          icon={<TrendingUp size={14} color={"#fb923c"} />}
          label="Average / entry"
          value={formatINR(avg)}
        />
        <Tile
          icon={<CalendarDays size={14} color={colors.zinc300} />}
          label="Months covered"
          value={data.monthlySeries.length.toString()}
        />
      </View>

      {/* Monthly bar list */}
      <Section title="MONTHLY">
        {data.monthlySeries.length === 0 ? (
          <Text variant="tiny" color={colors.zinc600}>
            Nothing in this range.
          </Text>
        ) : (
          (() => {
            const max = Math.max(...data.monthlySeries.map((m) => m.amount));
            return data.monthlySeries.map((m) => (
              <BarRow
                key={m.month}
                label={prettyMonth(m.month)}
                amount={m.amount}
                max={max}
                color={colors.yellow400}
              />
            ));
          })()
        )}
      </Section>

      {/* Breakdowns — surfaced in the same priority order as the web
          page (spentType → vendor → paid to → payment type). */}
      <BreakdownSection
        title="BY SPENT TYPE"
        rows={data.bySpentType}
        color={colors.emerald400}
      />
      <BreakdownSection
        title="BY VENDOR"
        rows={data.byVendor}
        color={colors.yellow400}
      />
      <BreakdownSection
        title="BY PAID TO"
        rows={data.byToName}
        color={"#fb923c"}
      />
      <BreakdownSection
        title="BY PAYMENT TYPE"
        rows={data.byPaymentType}
        color={colors.zinc300}
      />
      <BreakdownSection
        title="BY DONE BY"
        rows={data.byDoneBy}
        color={"#a78bfa"}
      />
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

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
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

function BreakdownSection({
  title,
  rows,
  color,
}: {
  title: string;
  rows: { label: string; amount: number; count: number }[];
  color: string;
}) {
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.amount));
  return (
    <Section title={title}>
      {rows.slice(0, 12).map((r) => (
        <BarRow
          key={r.label}
          label={r.label}
          amount={r.amount}
          subtext={`${r.count} entr${r.count === 1 ? "y" : "ies"}`}
          max={max}
          color={color}
        />
      ))}
    </Section>
  );
}

function BarRow({
  label,
  amount,
  subtext,
  max,
  color,
}: {
  label: string;
  amount: number;
  subtext?: string;
  max: number;
  color: string;
}) {
  const widthPct = max > 0 ? (amount / max) * 100 : 0;
  return (
    <View style={styles.barRow}>
      <View style={styles.barHead}>
        <Text variant="tiny" color={colors.zinc300} numberOfLines={1} style={{ flex: 1 }}>
          {label}
        </Text>
        <Text variant="tiny" color={colors.foreground} weight="600">
          {formatINR(amount)}
        </Text>
      </View>
      <View style={styles.barTrack}>
        <View
          style={[
            styles.barFill,
            { width: `${widthPct}%`, backgroundColor: color, opacity: 0.45 },
          ]}
        />
      </View>
      {subtext ? (
        <Text variant="tiny" color={colors.zinc600}>
          {subtext}
        </Text>
      ) : null}
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

function prettyMonth(yyyymm: string): string {
  // "2026-04" → "Apr 2026"
  const [y, m] = yyyymm.split("-");
  const months = [
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
  return `${months[Number(m) - 1] ?? m} ${y}`;
}

function formatINR(n: number): string {
  if (Number.isInteger(n)) return `₹${n.toLocaleString("en-IN")}`;
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

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
  section: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["4"],
    gap: spacing["2"],
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1.5"],
  },
  sectionTitle: { letterSpacing: 1.5, fontWeight: "700" },
  barRow: { gap: 4 },
  barHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.zinc800,
    overflow: "hidden",
  },
  barFill: {
    height: 6,
    borderRadius: 3,
  },
  errorBlock: {
    padding: spacing["4"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.30)",
    backgroundColor: "rgba(239, 68, 68, 0.10)",
    gap: spacing["1"],
  },
});
