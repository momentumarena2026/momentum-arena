import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Clock,
  Gift,
  RotateCcw,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { colors, radius, spacing } from "../../theme";
import { rewardsApi, type RewardTxnRow } from "../../lib/rewards";
import { trackRewardsView } from "../../lib/analytics";

function paiseAsRupees(paise: number): string {
  const rupees = Math.round(paise / 100);
  return `₹${rupees.toLocaleString("en-IN")}`;
}

function txnLabel(type: string): string {
  switch (type) {
    case "EARNED_BOOKING":
      return "Booking reward";
    case "EARNED_CAFE":
      return "Cafe reward";
    case "EARNED_SIGNUP":
      return "Welcome bonus";
    case "EARNED_REFERRAL":
      return "Referral bonus";
    case "EARNED_BIRTHDAY":
      return "Birthday bonus";
    case "EARNED_ADJUSTMENT":
      return "Bonus points";
    case "ADJUSTMENT_REFUND":
      return "Refund credit";
    case "REDEEMED_BOOKING":
      return "Booking discount";
    case "REDEEMED_CAFE":
      return "Cafe discount";
    case "REVOKED":
      return "Reversed";
    case "EXPIRED":
      return "Expired";
    case "ADJUSTMENT_DEBIT":
      return "Adjustment";
    default:
      return type;
  }
}

function isCredit(type: string): boolean {
  return type.startsWith("EARNED_") || type === "ADJUSTMENT_REFUND";
}

function TxnIcon({ type, color }: { type: string; color: string }) {
  if (type === "REDEEMED_BOOKING" || type === "REDEEMED_CAFE")
    return <ArrowUpFromLine size={16} color={color} />;
  if (type === "EXPIRED") return <Clock size={16} color={color} />;
  if (type === "REVOKED" || type === "ADJUSTMENT_DEBIT")
    return <RotateCcw size={16} color={color} />;
  if (type === "ADJUSTMENT_REFUND") return <TrendingUp size={16} color={color} />;
  if (
    type === "EARNED_ADJUSTMENT" ||
    type === "EARNED_SIGNUP" ||
    type === "EARNED_BIRTHDAY"
  )
    return <Gift size={16} color={color} />;
  return <ArrowDownToLine size={16} color={color} />;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function RewardsScreen() {
  const overviewQ = useQuery({
    queryKey: ["rewards", "overview"],
    queryFn: () => rewardsApi.overview(),
  });
  const firstPageQ = useQuery({
    queryKey: ["rewards", "transactions", "first"],
    queryFn: () => rewardsApi.transactions({ limit: 20 }),
  });

  // Pagination state is independent of TanStack Query — we keep the first
  // page in `firstPageQ` and accumulate subsequent pages locally so a
  // pull-to-refresh fully resets activity.
  const [extraRows, setExtraRows] = useState<RewardTxnRow[]>([]);
  // `null` means "use whatever cursor the first page returned". After the
  // first load-more it holds that page's nextCursor (or null when exhausted).
  const [loadedCursor, setLoadedCursor] = useState<string | null>(null);
  const [hasLoadedMore, setHasLoadedMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const handleRefresh = useCallback(async () => {
    setExtraRows([]);
    setLoadedCursor(null);
    setHasLoadedMore(false);
    setExhausted(false);
    await Promise.all([overviewQ.refetch(), firstPageQ.refetch()]);
  }, [overviewQ, firstPageQ]);

  const handleLoadMore = useCallback(async () => {
    if (loadingMore || exhausted) return;
    // Use the most recent paginated cursor if we've already loaded more
    // pages, otherwise fall back to the first page's nextCursor.
    const before = hasLoadedMore
      ? loadedCursor
      : firstPageQ.data?.nextCursor ?? null;
    if (!before) {
      setExhausted(true);
      return;
    }
    setLoadingMore(true);
    try {
      const next = await rewardsApi.transactions({ before, limit: 20 });
      setExtraRows((prev) => [...prev, ...next.rows]);
      setLoadedCursor(next.nextCursor);
      setHasLoadedMore(true);
      if (!next.hasMore) setExhausted(true);
    } finally {
      setLoadingMore(false);
    }
  }, [
    exhausted,
    firstPageQ.data?.nextCursor,
    hasLoadedMore,
    loadedCursor,
    loadingMore,
  ]);

  const overview = overviewQ.data?.overview ?? null;

  // Fire-once discovery event for the Rewards funnel. Waits for the
  // first overview load so we can include the user's balance — useful
  // for cohorting "did high-balance users come back vs low-balance".
  const trackedRef = useRef(false);
  useEffect(() => {
    if (!trackedRef.current && overview) {
      trackedRef.current = true;
      trackRewardsView(overview.pointsAvailable);
    }
  }, [overview]);
  const firstRows = firstPageQ.data?.rows ?? [];
  const rows = [...firstRows, ...extraRows];
  const isLoading = overviewQ.isLoading || firstPageQ.isLoading;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={overviewQ.isRefetching || firstPageQ.isRefetching}
            onRefresh={() => void handleRefresh()}
            tintColor={colors.primary}
          />
        }
      >
        {/* Hero balance */}
        <View style={styles.hero}>
          <View style={styles.heroChip}>
            <Sparkles size={14} color={colors.emerald400} />
            <Text style={styles.heroLabel}>Momentum Points</Text>
          </View>
          <Text style={styles.heroBalance}>
            {isLoading
              ? "—"
              : (overview?.pointsAvailable ?? 0).toLocaleString("en-IN")}
          </Text>
          <Text style={styles.heroValue}>
            Worth {paiseAsRupees(overview?.pointsValuePaise ?? 0)} towards your next booking
          </Text>

          {overview && !overview.config.enabled && (
            <View style={styles.warnPill}>
              <Text style={styles.warnPillText}>
                Rewards are temporarily paused
              </Text>
            </View>
          )}
          {overview && overview.expiringSoonPoints > 0 && (
            <View style={styles.warnPill}>
              <Clock size={12} color="#fcd34d" />
              <Text style={styles.warnPillText}>
                {overview.expiringSoonPoints.toLocaleString("en-IN")} expiring in 30 days
              </Text>
            </View>
          )}
        </View>

        {/* Lifetime stats */}
        <View style={styles.statsRow}>
          <StatCell
            label="Earned"
            value={overview?.pointsLifetimeEarned ?? 0}
            color={colors.emerald400}
            icon={<ArrowDownToLine size={12} color={colors.emerald400} />}
          />
          <StatCell
            label="Redeemed"
            value={overview?.pointsLifetimeRedeemed ?? 0}
            color="#7dd3fc"
            icon={<ArrowUpFromLine size={12} color="#7dd3fc" />}
          />
          <StatCell
            label="Expired"
            value={overview?.pointsLifetimeExpired ?? 0}
            color={colors.zinc400}
            icon={<Clock size={12} color={colors.zinc400} />}
          />
        </View>

        {/* How it works */}
        {overview && (
          <View style={styles.howCard}>
            <View style={styles.howHeader}>
              <TrendingUp size={14} color={colors.emerald400} />
              <Text style={styles.howTitle}>How it works</Text>
            </View>
            <Text style={styles.howLine}>
              • Earn {(overview.config.earnRateBookingBps / 100).toFixed(0)}% back on every confirmed booking
              {overview.config.cafeEarnEnabled
                ? ` and ${(overview.config.earnRateCafeBps / 100).toFixed(0)}% on cafe orders`
                : ""}
            </Text>
            <Text style={styles.howLine}>
              • 1 point = {paiseAsRupees(overview.config.pointValuePaise)} off your bill
            </Text>
            <Text style={styles.howLine}>
              • Minimum {overview.config.minPointsToRedeem.toLocaleString("en-IN")} points to redeem
            </Text>
            <Text style={styles.howLine}>
              • Use up to {overview.config.maxRedemptionPctOfBill}% of any bill
            </Text>
            <Text style={styles.howLine}>
              • Points expire 12 months after they're earned
            </Text>
          </View>
        )}

        {/* Activity */}
        <Text style={styles.activityHeader}>Activity</Text>
        {isLoading ? (
          <View style={styles.loadingBlock}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <TrendingDown size={20} color={colors.zinc500} />
            </View>
            <Text style={styles.emptyTitle}>No activity yet</Text>
            <Text style={styles.emptySub}>
              Your points history will show up here
            </Text>
          </View>
        ) : (
          <View style={styles.txnList}>
            {rows.map((r) => {
              const credit = isCredit(r.type);
              const color = credit ? colors.emerald400 : colors.zinc300;
              const iconBg = credit ? colors.emerald500_20 : colors.zinc800;
              return (
                <View key={r.id} style={styles.txnRow}>
                  <View style={[styles.txnIcon, { backgroundColor: iconBg }]}>
                    <TxnIcon
                      type={r.type}
                      color={credit ? colors.emerald400 : colors.zinc400}
                    />
                  </View>
                  <View style={styles.txnBody}>
                    <Text style={styles.txnLabel} numberOfLines={1}>
                      {txnLabel(r.type)}
                    </Text>
                    <Text style={styles.txnDate}>
                      {formatDate(r.createdAt)}
                      {r.reason ? ` • ${r.reason}` : ""}
                    </Text>
                  </View>
                  <View style={styles.txnRight}>
                    <Text style={[styles.txnPoints, { color }]}>
                      {credit ? "+" : ""}
                      {r.points.toLocaleString("en-IN")}
                    </Text>
                    <Text style={styles.txnUnit}>pts</Text>
                  </View>
                </View>
              );
            })}

            {!exhausted && (firstPageQ.data?.hasMore || hasLoadedMore) && (
              <Pressable
                onPress={() => void handleLoadMore()}
                style={({ pressed }) => [
                  styles.loadMoreBtn,
                  pressed && styles.loadMorePressed,
                ]}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <ActivityIndicator color={colors.primary} size="small" />
                ) : (
                  <Text style={styles.loadMoreText}>Load more</Text>
                )}
              </Pressable>
            )}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function StatCell({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: number;
  color: string;
  icon: React.ReactNode;
}) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statHead}>
        {icon}
        <Text style={[styles.statLabel, { color }]}>{label}</Text>
      </View>
      <Text style={styles.statValue}>{value.toLocaleString("en-IN")}</Text>
      <Text style={styles.statSub}>lifetime</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["6"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["8"],
    gap: spacing["4"],
  },
  hero: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.emerald500_30,
    backgroundColor: colors.emerald500_05,
    padding: spacing["6"],
    gap: spacing["1"],
    overflow: "hidden",
  },
  heroChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  heroLabel: {
    fontSize: 11,
    color: colors.emerald400,
    fontWeight: "700",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  heroBalance: {
    marginTop: spacing["2"],
    fontSize: 48,
    lineHeight: 52,
    fontWeight: "800",
    color: colors.foreground,
  },
  heroValue: {
    fontSize: 13,
    color: "#6ee7b7",
  },
  warnPill: {
    marginTop: spacing["3"],
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.30)",
    backgroundColor: "rgba(245, 158, 11, 0.10)",
    paddingHorizontal: spacing["3"],
    paddingVertical: 6,
  },
  warnPillText: {
    fontSize: 12,
    color: "#fcd34d",
    fontWeight: "500",
  },

  statsRow: {
    flexDirection: "row",
    gap: spacing["3"],
  },
  statCard: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["3"],
  },
  statHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  statValue: {
    marginTop: 6,
    fontSize: 20,
    fontWeight: "700",
    color: colors.foreground,
  },
  statSub: {
    fontSize: 10,
    color: colors.zinc600,
  },

  howCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: "rgba(24, 24, 27, 0.40)",
    padding: spacing["4"],
    gap: 6,
  },
  howHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: spacing["1"],
  },
  howTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.foreground,
  },
  howLine: {
    fontSize: 12,
    color: colors.zinc400,
    lineHeight: 18,
  },

  activityHeader: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 1,
    color: colors.zinc500,
    textTransform: "uppercase",
    marginTop: spacing["2"],
  },
  loadingBlock: {
    paddingVertical: spacing["8"],
    alignItems: "center",
  },

  txnList: {
    gap: spacing["2"],
  },
  txnRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(39, 39, 42, 0.80)",
    backgroundColor: "rgba(24, 24, 27, 0.50)",
    padding: spacing["3.5"],
  },
  txnIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  txnBody: {
    flex: 1,
    minWidth: 0,
  },
  txnLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.foreground,
  },
  txnDate: {
    marginTop: 2,
    fontSize: 11,
    color: colors.zinc500,
  },
  txnRight: {
    alignItems: "flex-end",
  },
  txnPoints: {
    fontSize: 14,
    fontWeight: "700",
  },
  txnUnit: {
    fontSize: 10,
    color: colors.zinc600,
  },

  loadMoreBtn: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: "rgba(24, 24, 27, 0.60)",
    paddingVertical: spacing["3"],
    alignItems: "center",
  },
  loadMorePressed: {
    opacity: 0.7,
  },
  loadMoreText: {
    fontSize: 13,
    color: colors.zinc400,
  },

  emptyCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    borderStyle: "dashed",
    backgroundColor: "rgba(24, 24, 27, 0.30)",
    paddingVertical: spacing["8"],
    paddingHorizontal: spacing["6"],
    alignItems: "center",
    gap: 4,
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.zinc800,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing["2"],
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.zinc400,
  },
  emptySub: {
    fontSize: 12,
    color: colors.zinc600,
    textAlign: "center",
  },
});
