import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type ColorValue,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BookOpen,
  ChevronRight,
  Clock,
  Coffee,
  ExternalLink,
  Gift,
  Hash,
  Receipt,
  RotateCcw,
  ShoppingBag,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { colors, radius, spacing } from "../../theme";
import { rewardsApi, type RewardTxnRow } from "../../lib/rewards";
import { trackRewardsView } from "../../lib/analytics";
import type { AccountStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<AccountStackParamList, "Rewards">;

// ─── Transaction metadata ────────────────────────────────────────────────
// Single source of truth for every RewardTransaction.type the API can
// emit — keeps label, description, icon, and tone in lock-step so a
// new enum value can't drift into rendering with the wrong color.

type Tone = "credit" | "debit" | "neutral";

interface TxnMeta {
  label: string;
  /** One-line plain-English description shown under the label. */
  desc: string;
  /** credit = earn (emerald); debit = redeem (yellow); neutral = expired/reversed/adjust (zinc). */
  tone: Tone;
  Icon: React.ComponentType<{ size?: number; color?: ColorValue }>;
}

const TXN_META: Record<string, TxnMeta> = {
  EARNED_BOOKING: {
    label: "Booking reward",
    desc: "Points earned from a confirmed booking",
    tone: "credit",
    Icon: ArrowDownToLine,
  },
  EARNED_CAFE: {
    label: "Cafe reward",
    desc: "Points earned on a cafe order",
    tone: "credit",
    Icon: Coffee,
  },
  EARNED_SIGNUP: {
    label: "Welcome bonus",
    desc: "Onboarding gift — thanks for signing up",
    tone: "credit",
    Icon: Sparkles,
  },
  EARNED_REFERRAL: {
    label: "Referral bonus",
    desc: "A friend you referred booked their first slot",
    tone: "credit",
    Icon: Gift,
  },
  EARNED_BIRTHDAY: {
    label: "Birthday bonus",
    desc: "Happy birthday from Momentum Arena",
    tone: "credit",
    Icon: Gift,
  },
  EARNED_ADJUSTMENT: {
    label: "Bonus points",
    desc: "Manual credit by the venue admin",
    tone: "credit",
    Icon: Gift,
  },
  ADJUSTMENT_REFUND: {
    label: "Refund credit",
    desc: "Points returned after a refund",
    tone: "credit",
    Icon: TrendingUp,
  },
  REDEEMED_BOOKING: {
    label: "Booking discount",
    desc: "Points spent on a booking checkout",
    tone: "debit",
    Icon: ArrowUpFromLine,
  },
  REDEEMED_CAFE: {
    label: "Cafe discount",
    desc: "Points spent on a cafe order",
    tone: "debit",
    Icon: ArrowUpFromLine,
  },
  REVOKED: {
    label: "Reversed",
    desc: "An earlier credit was reversed (e.g. booking cancellation)",
    tone: "neutral",
    Icon: RotateCcw,
  },
  EXPIRED: {
    label: "Expired",
    desc: "Points expired — past the 12-month window",
    tone: "neutral",
    Icon: Clock,
  },
  ADJUSTMENT_DEBIT: {
    label: "Adjustment",
    desc: "Manual debit by the venue admin",
    tone: "neutral",
    Icon: RotateCcw,
  },
};

const FALLBACK_META = TXN_META.EARNED_ADJUSTMENT;

type ToneStyle = {
  iconBg: ColorValue;
  iconBorder: ColorValue;
  iconColor: ColorValue;
  pointsColor: ColorValue;
  rupeesColor: ColorValue;
};

const TONE_STYLES: Record<Tone, ToneStyle> = {
  credit: {
    iconBg: colors.emerald500_20,
    iconBorder: colors.emerald500_30,
    iconColor: colors.emerald400,
    pointsColor: colors.emerald400,
    rupeesColor: "#6ee7b7",
  },
  debit: {
    iconBg: colors.yellow500_10,
    iconBorder: colors.yellow500_30,
    iconColor: colors.yellow300,
    pointsColor: colors.yellow300,
    rupeesColor: "#fde68a",
  },
  neutral: {
    iconBg: colors.zinc800,
    iconBorder: colors.zinc700,
    iconColor: colors.zinc400,
    pointsColor: colors.zinc300,
    rupeesColor: colors.zinc500,
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────

function paiseAsRupees(paise: number): string {
  const rupees = Math.round(paise / 100);
  return `₹${rupees.toLocaleString("en-IN")}`;
}

function paiseAsRupeesPrecise(paise: number): string {
  if (!paise) return "₹0";
  const rupees = Math.abs(paise) / 100;
  const isWhole = rupees === Math.floor(rupees);
  return `₹${rupees.toLocaleString("en-IN", {
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatTxnDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

function relativeFromNow(iso: string): string {
  const target = new Date(iso).getTime();
  const diffDays = Math.round((target - Date.now()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "expired";
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";
  if (diffDays < 30) return `in ${diffDays} days`;
  const months = Math.round(diffDays / 30);
  return months === 1 ? "in 1 month" : `in ${months} months`;
}

function shortId(id: string): string {
  return id.slice(-6).toUpperCase();
}

type Filter = "ALL" | "EARNED" | "REDEEMED";

// ─── Screen ──────────────────────────────────────────────────────────────

export function RewardsScreen() {
  const navigation = useNavigation<Nav>();
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
  const [loadedCursor, setLoadedCursor] = useState<string | null>(null);
  const [hasLoadedMore, setHasLoadedMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<Filter>("ALL");

  const handleRefresh = useCallback(async () => {
    setExtraRows([]);
    setLoadedCursor(null);
    setHasLoadedMore(false);
    setExhausted(false);
    await Promise.all([overviewQ.refetch(), firstPageQ.refetch()]);
  }, [overviewQ, firstPageQ]);

  const handleLoadMore = useCallback(async () => {
    if (loadingMore || exhausted) return;
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
  const firstRows = firstPageQ.data?.rows ?? [];
  const rows = useMemo(() => [...firstRows, ...extraRows], [firstRows, extraRows]);
  const isLoading = overviewQ.isLoading || firstPageQ.isLoading;

  // Fire-once discovery event for the Rewards funnel.
  const trackedRef = useRef(false);
  useEffect(() => {
    if (!trackedRef.current && overview) {
      trackedRef.current = true;
      trackRewardsView(overview.pointsAvailable);
    }
  }, [overview]);

  // This-month aggregates for the summary strip.
  const monthTotals = useMemo(() => {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${now.getMonth()}`;
    let earned = 0;
    let redeemed = 0;
    for (const r of rows) {
      const d = new Date(r.createdAt);
      if (`${d.getFullYear()}-${d.getMonth()}` !== monthKey) continue;
      if (r.points > 0) earned += r.points;
      else if (r.points < 0) redeemed += Math.abs(r.points);
    }
    return { earned, redeemed };
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (filter === "ALL") return rows;
    if (filter === "EARNED") return rows.filter((r) => r.points > 0);
    if (filter === "REDEEMED") return rows.filter((r) => r.points < 0);
    return rows;
  }, [rows, filter]);

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
            color={colors.yellow300}
            icon={<ArrowUpFromLine size={12} color={colors.yellow300} />}
          />
          <StatCell
            label="Expired"
            value={overview?.pointsLifetimeExpired ?? 0}
            color={colors.zinc400}
            icon={<Clock size={12} color={colors.zinc400} />}
          />
        </View>

        {/* How rewards work link — drills to the graphical breakdown */}
        <Pressable
          onPress={() => navigation.navigate("RewardsHowItWorks")}
          style={({ pressed }) => [
            styles.howLink,
            pressed && { opacity: 0.85 },
          ]}
        >
          <View style={styles.howLinkIcon}>
            <BookOpen size={16} color={colors.zinc300} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.howLinkTitle}>How rewards work</Text>
            <Text style={styles.howLinkSub}>
              Earn rates, caps, expiry — the full breakdown
            </Text>
          </View>
          <ChevronRight size={16} color={colors.zinc500} />
        </Pressable>

        {/* This-month summary — emerald for earned, yellow for redeemed */}
        {!isLoading && rows.length > 0 && (
          <View style={styles.monthRow}>
            <View style={styles.monthCardEarned}>
              <Text style={styles.monthLabelEarned}>EARNED THIS MONTH</Text>
              <Text style={styles.monthValueEarned}>
                +{monthTotals.earned.toLocaleString("en-IN")}
                <Text style={styles.monthUnitEarned}> pts</Text>
              </Text>
            </View>
            <View style={styles.monthCardRedeemed}>
              <Text style={styles.monthLabelRedeemed}>REDEEMED THIS MONTH</Text>
              <Text style={styles.monthValueRedeemed}>
                −{monthTotals.redeemed.toLocaleString("en-IN")}
                <Text style={styles.monthUnitRedeemed}> pts</Text>
              </Text>
            </View>
          </View>
        )}

        {/* Activity header + filter pills */}
        <View style={styles.activityHead}>
          <Text style={styles.activityHeader}>Activity</Text>
          <View style={styles.filterRow}>
            {(["ALL", "EARNED", "REDEEMED"] as const).map((f) => (
              <FilterPill
                key={f}
                active={filter === f}
                tone={f === "EARNED" ? "credit" : f === "REDEEMED" ? "debit" : "neutral"}
                label={f === "ALL" ? "All" : f === "EARNED" ? "Earned" : "Redeemed"}
                onPress={() => setFilter(f)}
              />
            ))}
          </View>
        </View>

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
        ) : filteredRows.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>
              No {filter === "EARNED" ? "earned" : "redeemed"} entries
            </Text>
            <Text style={styles.emptySub}>
              In the rows loaded so far. Tap "Load more" to scan further back.
            </Text>
          </View>
        ) : (
          <View style={styles.txnList}>
            {filteredRows.map((r) => (
              <TxnRow
                key={r.id}
                row={r}
                onOpenBooking={(bookingId) =>
                  navigation.navigate("BookingDetail", { bookingId })
                }
              />
            ))}

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

// ─── Pieces ──────────────────────────────────────────────────────────────

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

function FilterPill({
  active,
  label,
  tone,
  onPress,
}: {
  active: boolean;
  label: string;
  tone: Tone;
  onPress: () => void;
}) {
  // Active pill takes the tone's color. Inactive is neutral zinc.
  const activeBg =
    tone === "credit"
      ? colors.emerald500_20
      : tone === "debit"
        ? colors.yellow500_10
        : colors.zinc800;
  const activeBorder =
    tone === "credit"
      ? colors.emerald500_30
      : tone === "debit"
        ? colors.yellow500_30
        : colors.zinc600;
  const activeText =
    tone === "credit"
      ? colors.emerald400
      : tone === "debit"
        ? colors.yellow300
        : colors.foreground;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        active
          ? { backgroundColor: activeBg, borderColor: activeBorder }
          : styles.pillInactive,
        pressed && { opacity: 0.85 },
      ]}
    >
      <Text
        style={[
          styles.pillText,
          active ? { color: activeText } : styles.pillTextInactive,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function TxnRow({
  row,
  onOpenBooking,
}: {
  row: RewardTxnRow;
  onOpenBooking: (bookingId: string) => void;
}) {
  const meta = TXN_META[row.type] ?? FALLBACK_META;
  const tone = TONE_STYLES[meta.tone];
  const Icon = meta.Icon;
  const sign = row.points > 0 ? "+" : row.points < 0 ? "−" : "";
  const rupeesValue = row.pointsValuePaise
    ? paiseAsRupeesPrecise(row.pointsValuePaise)
    : null;
  const isCredit = meta.tone === "credit";

  // Expiry urgency — yellow when under 30 days, grey otherwise.
  let expiryNode: React.ReactNode = null;
  if (isCredit && row.expiresAt) {
    const target = new Date(row.expiresAt).getTime();
    const diffDays = Math.round((target - Date.now()) / (1000 * 60 * 60 * 24));
    const isUrgent = diffDays >= 0 && diffDays < 30;
    expiryNode = (
      <View style={styles.metaChunk}>
        <Clock size={11} color={isUrgent ? colors.yellow300 : colors.zinc500} />
        <Text
          style={[
            styles.metaText,
            { color: isUrgent ? colors.yellow300 : colors.zinc500 },
          ]}
        >
          expires {relativeFromNow(row.expiresAt)}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.txnRow}>
      <View style={styles.txnHeader}>
        <View
          style={[
            styles.txnIcon,
            {
              backgroundColor: tone.iconBg,
              borderColor: tone.iconBorder,
            },
          ]}
        >
          <Icon size={16} color={tone.iconColor} />
        </View>
        <View style={styles.txnBody}>
          <Text style={styles.txnLabel} numberOfLines={1}>
            {meta.label}
          </Text>
          <Text style={styles.txnDesc} numberOfLines={2}>
            {meta.desc}
          </Text>
        </View>
        <View style={styles.txnRight}>
          <Text style={[styles.txnPoints, { color: tone.pointsColor }]}>
            {sign}
            {Math.abs(row.points).toLocaleString("en-IN")}
            <Text style={styles.txnUnit}> pts</Text>
          </Text>
          {rupeesValue ? (
            <Text style={[styles.txnRupees, { color: tone.rupeesColor }]}>
              {row.points > 0 ? "worth " : row.points < 0 ? "saved " : ""}
              {rupeesValue}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Metadata strip — date · TXN id · booking link · expiry */}
      <View style={styles.metaRow}>
        <View style={styles.metaChunk}>
          <Clock size={11} color={colors.zinc500} />
          <Text style={styles.metaText}>{formatTxnDate(row.createdAt)}</Text>
        </View>
        <Text style={styles.metaSep}>·</Text>
        <View style={styles.metaChunk}>
          <Hash size={11} color={colors.zinc500} />
          <Text style={styles.metaText}>TXN {shortId(row.id)}</Text>
        </View>

        {row.bookingId ? (
          <>
            <Text style={styles.metaSep}>·</Text>
            <Pressable
              onPress={() => onOpenBooking(row.bookingId!)}
              style={({ pressed }) => [
                styles.metaChunk,
                pressed && { opacity: 0.7 },
              ]}
              hitSlop={6}
            >
              <Receipt size={11} color={colors.zinc300} />
              <Text style={[styles.metaText, styles.metaTextLink]}>
                Booking {shortId(row.bookingId)}
              </Text>
              <ExternalLink size={10} color={colors.zinc500} />
            </Pressable>
          </>
        ) : null}

        {row.cafeOrderId ? (
          <>
            <Text style={styles.metaSep}>·</Text>
            <View style={styles.metaChunk}>
              <ShoppingBag size={11} color={colors.zinc400} />
              <Text style={styles.metaText}>
                Cafe {shortId(row.cafeOrderId)}
              </Text>
            </View>
          </>
        ) : null}

        {row.reason ? (
          <>
            <Text style={styles.metaSep}>·</Text>
            <Text style={[styles.metaText, styles.metaTextItalic]}>
              {row.reason}
            </Text>
          </>
        ) : null}

        {expiryNode ? (
          <>
            <Text style={styles.metaSep}>·</Text>
            {expiryNode}
          </>
        ) : null}
      </View>
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

  howLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: "rgba(24, 24, 27, 0.40)",
    padding: spacing["4"],
  },
  howLinkIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.zinc800,
    alignItems: "center",
    justifyContent: "center",
  },
  howLinkTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.foreground,
  },
  howLinkSub: {
    marginTop: 2,
    fontSize: 12,
    color: colors.zinc500,
  },

  monthRow: {
    flexDirection: "row",
    gap: spacing["3"],
  },
  monthCardEarned: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.emerald500_30,
    backgroundColor: colors.emerald500_05,
    padding: spacing["3"],
  },
  monthLabelEarned: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.5,
    color: "#6ee7b7",
  },
  monthValueEarned: {
    marginTop: 4,
    fontSize: 20,
    fontWeight: "700",
    color: colors.emerald400,
  },
  monthUnitEarned: {
    fontSize: 11,
    color: "#6ee7b7",
  },
  monthCardRedeemed: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.yellow500_30,
    backgroundColor: colors.yellow500_10,
    padding: spacing["3"],
  },
  monthLabelRedeemed: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.5,
    color: "#fde68a",
  },
  monthValueRedeemed: {
    marginTop: 4,
    fontSize: 20,
    fontWeight: "700",
    color: colors.yellow300,
  },
  monthUnitRedeemed: {
    fontSize: 11,
    color: "#fde68a",
  },

  activityHead: {
    gap: spacing["2"],
  },
  activityHeader: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 1,
    color: colors.zinc500,
    textTransform: "uppercase",
  },
  filterRow: {
    flexDirection: "row",
    gap: spacing["2"],
  },
  pill: {
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing["3"],
    paddingVertical: 6,
  },
  pillInactive: {
    borderColor: colors.zinc800,
    backgroundColor: "rgba(24, 24, 27, 0.40)",
  },
  pillText: {
    fontSize: 12,
    fontWeight: "700",
  },
  pillTextInactive: {
    color: colors.zinc400,
  },

  loadingBlock: {
    paddingVertical: spacing["8"],
    alignItems: "center",
  },

  txnList: {
    gap: spacing["2"],
  },
  txnRow: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(39, 39, 42, 0.80)",
    backgroundColor: "rgba(24, 24, 27, 0.50)",
    padding: spacing["3.5"],
    gap: spacing["2"],
  },
  txnHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing["3"],
  },
  txnIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  txnBody: {
    flex: 1,
    minWidth: 0,
  },
  txnLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.foreground,
  },
  txnDesc: {
    marginTop: 2,
    fontSize: 11,
    color: colors.zinc500,
    lineHeight: 15,
  },
  txnRight: {
    alignItems: "flex-end",
    flexShrink: 0,
  },
  txnPoints: {
    fontSize: 16,
    fontWeight: "800",
  },
  txnUnit: {
    fontSize: 10,
    color: colors.zinc500,
    fontWeight: "500",
  },
  txnRupees: {
    marginTop: 2,
    fontSize: 11,
  },

  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 4,
    marginLeft: 36 + spacing["3"],
  },
  metaChunk: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  metaText: {
    fontSize: 11,
    color: colors.zinc500,
  },
  metaTextLink: {
    color: colors.zinc300,
  },
  metaTextItalic: {
    fontStyle: "italic",
  },
  metaSep: {
    fontSize: 11,
    color: colors.zinc700,
    marginHorizontal: 2,
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
