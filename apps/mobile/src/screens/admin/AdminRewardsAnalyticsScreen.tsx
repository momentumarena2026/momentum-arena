import { useMemo } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Sparkles,
  Users,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { BarChart, ChartCard, CHART_COLORS } from "../../components/charts";
import { colors, radius, spacing } from "../../theme";
import {
  adminRewardsApi,
  type AdminRewardsAnalytics,
  type AdminRewardsOverview,
} from "../../lib/admin-rewards";

/**
 * Read-only Rewards Analytics — mobile mirror of the web rewards
 * Analytics panel (`app/(admin)/admin/rewards/panels/analytics-panel.tsx`
 * + `getAdminRewardsAnalytics`). Full parity: the two 30-day daily strips
 * (earn / redeem) re-drawn with the RN bar chart, plus the top-earners
 * (30d) ranking. Headline liability/outstanding KPI cards are pulled from
 * the rewards overview so the screen reads self-contained, matching the
 * web rewards tab layout.
 *
 * Rewards money is in PAISE (unlike cafe, which is rupees), so the
 * liability tile uses the same paise→₹ rounding as the rewards home.
 */
export function AdminRewardsAnalyticsScreen() {
  const analyticsQ = useQuery({
    queryKey: ["admin", "rewards", "analytics"],
    queryFn: () => adminRewardsApi.analytics(),
    refetchOnWindowFocus: false,
  });
  const overviewQ = useQuery({
    queryKey: ["admin", "rewards", "overview"],
    queryFn: () => adminRewardsApi.overview(),
    refetchOnWindowFocus: false,
  });

  const refreshing =
    (analyticsQ.isFetching && !analyticsQ.isLoading) ||
    analyticsQ.isRefetching ||
    overviewQ.isRefetching;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void analyticsQ.refetch();
              void overviewQ.refetch();
            }}
            tintColor={colors.emerald400}
          />
        }
      >
        {analyticsQ.isLoading ? (
          <View style={{ gap: spacing["3"] }}>
            <View style={styles.tileRow}>
              <Skeleton width="48%" height={72} rounded="lg" />
              <Skeleton width="48%" height={72} rounded="lg" />
            </View>
            <Skeleton width="100%" height={220} rounded="lg" />
            <Skeleton width="100%" height={220} rounded="lg" />
          </View>
        ) : analyticsQ.isError ? (
          <View style={styles.errorBlock}>
            <Text variant="body" color={colors.destructive}>
              Couldn't load analytics. Pull to retry.
            </Text>
            <Text variant="tiny" color={colors.zinc500}>
              {analyticsQ.error instanceof Error
                ? analyticsQ.error.message
                : "Unknown error"}
            </Text>
          </View>
        ) : analyticsQ.data ? (
          <Body
            analytics={analyticsQ.data.analytics}
            overview={overviewQ.data?.overview}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Body({
  analytics,
  overview,
}: {
  analytics: AdminRewardsAnalytics;
  overview?: AdminRewardsOverview;
}) {
  const earnBars = useMemo(
    () =>
      analytics.dailyEarnLast30d.map((d) => ({
        label: dayMonth(d.date),
        value: d.points,
        color: colors.emerald400,
      })),
    [analytics.dailyEarnLast30d],
  );

  const redeemBars = useMemo(
    () =>
      analytics.dailyRedeemLast30d.map((d) => ({
        label: dayMonth(d.date),
        value: d.points,
        color: "#7dd3fc",
      })),
    [analytics.dailyRedeemLast30d],
  );

  const topEarnerBars = useMemo(
    () =>
      analytics.topEarners30d.map((u, i) => ({
        label: u.name ?? shortId(u.userId),
        value: u.points,
        color: CHART_COLORS[i % CHART_COLORS.length],
      })),
    [analytics.topEarners30d],
  );

  return (
    <View style={{ gap: spacing["3"] }}>
      <Text variant="heading" style={styles.heading}>
        Rewards analytics
      </Text>
      <Text variant="small" color={colors.zinc500} style={styles.subhead}>
        30-day earn / redeem activity and top earners.
      </Text>

      {/* ───── Headline KPIs (from overview) ───── */}
      {overview ? (
        <>
          <View style={styles.tileRow}>
            <Tile
              icon={<Sparkles size={14} color={colors.emerald400} />}
              label="Points outstanding"
              value={overview.totalPointsOutstanding.toLocaleString("en-IN")}
              sub={`Liability ${paiseAsRupees(overview.totalPaiseOutstanding)}`}
            />
            <Tile
              icon={<Users size={14} color={colors.zinc400} />}
              label="Users w/ balance"
              value={overview.totalUsersWithBalance.toLocaleString("en-IN")}
              sub="non-zero balance"
            />
          </View>
          <View style={styles.tileRow}>
            <Tile
              icon={<ArrowDownToLine size={14} color={colors.emerald400} />}
              label="Earned (30d)"
              value={overview.pointsEarnedLast30d.toLocaleString("en-IN")}
              valueColor={colors.emerald400}
              sub="all EARNED_* rows"
            />
            <Tile
              icon={<ArrowUpFromLine size={14} color="#7dd3fc" />}
              label="Redeemed (30d)"
              value={overview.pointsRedeemedLast30d.toLocaleString("en-IN")}
              valueColor="#7dd3fc"
              sub="REDEEMED rows"
            />
          </View>
        </>
      ) : null}

      {/* ───── Daily earn (30d) ───── */}
      <ChartCard title="Daily earn" subtitle="Points earned · last 30 days">
        {earnBars.length === 0 ? (
          <EmptyChart label="No earn activity in the last 30 days." />
        ) : (
          <BarChart
            data={earnBars}
            height={200}
            formatValue={(n) => compactPoints(n)}
          />
        )}
      </ChartCard>

      {/* ───── Daily redeem (30d) ───── */}
      <ChartCard title="Daily redeem" subtitle="Points redeemed · last 30 days">
        {redeemBars.length === 0 ? (
          <EmptyChart label="No redeem activity in the last 30 days." />
        ) : (
          <BarChart
            data={redeemBars}
            height={200}
            formatValue={(n) => compactPoints(n)}
          />
        )}
      </ChartCard>

      {/* ───── Top earners (30d) ───── */}
      <ChartCard title="Top earners" subtitle="By points earned · last 30 days">
        {topEarnerBars.length === 0 ? (
          <EmptyChart label="No earn activity in the last 30 days." />
        ) : (
          <View style={{ gap: spacing["3"] }}>
            <BarChart
              data={topEarnerBars}
              horizontal
              formatValue={(n) => n.toLocaleString("en-IN")}
            />
            <View style={{ gap: spacing["1"] }}>
              {analytics.topEarners30d.map((u, i) => (
                <View key={u.userId} style={styles.earnerRow}>
                  <Text
                    variant="tiny"
                    color={colors.zinc500}
                    style={styles.earnerRank}
                  >
                    {i + 1}
                  </Text>
                  <Text
                    variant="small"
                    color={colors.foreground}
                    numberOfLines={1}
                    style={styles.earnerName}
                  >
                    {u.name ?? shortId(u.userId)}
                  </Text>
                  <Text variant="small" color={colors.emerald400} weight="600">
                    {u.points.toLocaleString("en-IN")}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </ChartCard>

      <Text variant="tiny" color={colors.zinc600} style={styles.note}>
        The full signup → first-earn → first-redeem funnel lives on the web
        analytics dashboard. This view mirrors the rewards-tab Analytics panel.
      </Text>
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

function EmptyChart({ label }: { label: string }) {
  return (
    <View style={styles.emptyChart}>
      <Text variant="tiny" color={colors.zinc600}>
        {label}
      </Text>
    </View>
  );
}

// ─────────── Formatting helpers ───────────

/** YYYY-MM-DD → "D/M" short axis label. */
function dayMonth(date: string): string {
  const parts = date.split("-");
  if (parts.length === 3) return `${Number(parts[2])}/${Number(parts[1])}`;
  return date;
}

/** Rewards money is paise; round to whole ₹ like the rewards home. */
function paiseAsRupees(paise: number): string {
  return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
}

/** Compact point counts for chart axes (1.2k / 3.4M). */
function compactPoints(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["8"],
    gap: spacing["3"],
  },
  heading: {
    color: colors.foreground,
  },
  subhead: {
    marginTop: -spacing["1"],
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
    height: 120,
    alignItems: "center",
    justifyContent: "center",
  },
  earnerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2.5"],
    paddingVertical: spacing["1.5"],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.zinc800,
  },
  earnerRank: { width: 18, textAlign: "center" },
  earnerName: { flex: 1 },
  note: {
    textAlign: "center",
    marginTop: spacing["1"],
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
