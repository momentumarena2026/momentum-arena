import { useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronRight,
  Clock,
  ListOrdered,
  SlidersHorizontal,
  Sparkles,
  Users,
  X,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { colors, radius, spacing } from "../../theme";
import {
  adminRewardsApi,
  type AdminAlertRow,
} from "../../lib/admin-rewards";
import type { AdminRewardsStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<
  AdminRewardsStackParamList,
  "AdminRewardsHome"
>;

const KIND_LABELS: Record<string, string> = {
  RAPID_EARN_REDEEM: "Rapid earn → redeem",
  HIGH_VELOCITY_EARN: "High-velocity earn",
  REFUND_THEN_RETAIN: "Refund then retain",
  DUPLICATE_PHONE_USERS: "Duplicate phone",
  BULK_REDEMPTION: "Bulk redemption",
  NEGATIVE_BALANCE: "Negative balance",
  PARTIAL_REVOKE_SHORTFALL: "Revoke shortfall",
  ADJUSTMENT_AUDIT: "Manual adjustment",
};

const SEVERITY_TONE: Record<string, { bg: string; text: string }> = {
  HIGH: { bg: "rgba(239, 68, 68, 0.10)", text: "#fca5a5" },
  MEDIUM: { bg: "rgba(245, 158, 11, 0.10)", text: "#fcd34d" },
  LOW: { bg: colors.zinc800, text: colors.zinc300 },
};

function paiseAsRupees(paise: number): string {
  return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
}

export function AdminRewardsScreen() {
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();

  const overviewQ = useQuery({
    queryKey: ["admin", "rewards", "overview"],
    queryFn: () => adminRewardsApi.overview(),
  });
  const alertsQ = useQuery({
    queryKey: ["admin", "rewards", "alerts", "OPEN"],
    queryFn: () => adminRewardsApi.alerts("OPEN"),
  });

  const updateAlertM = useMutation({
    mutationFn: (input: {
      id: string;
      status: "DISMISSED" | "ACTIONED";
      resolution?: string;
    }) => adminRewardsApi.updateAlert(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "rewards"] });
    },
    onError: (err: unknown) => {
      Alert.alert(
        "Couldn't update alert",
        err instanceof Error ? err.message : "Try again.",
      );
    },
  });

  const handleRefresh = useCallback(async () => {
    await Promise.all([overviewQ.refetch(), alertsQ.refetch()]);
  }, [overviewQ, alertsQ]);

  const overview = overviewQ.data?.overview;
  const alerts = alertsQ.data?.alerts ?? [];
  const loading = overviewQ.isLoading || alertsQ.isLoading;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={overviewQ.isRefetching || alertsQ.isRefetching}
            onRefresh={() => void handleRefresh()}
            tintColor={colors.primary}
          />
        }
      >
        <Text style={styles.heading}>Momentum Rewards</Text>
        <Text style={styles.subhead}>
          Live monitoring + bulk grant. Full config + analytics on web.
        </Text>

        {loading ? (
          <View style={styles.loadingBlock}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : overview ? (
          <>
            <View style={styles.grid}>
              <StatCard
                icon={<Sparkles size={14} color={colors.emerald400} />}
                label="Points outstanding"
                value={overview.totalPointsOutstanding.toLocaleString("en-IN")}
                sub={`Liability ${paiseAsRupees(overview.totalPaiseOutstanding)}`}
              />
              <StatCard
                icon={<Users size={14} color={colors.zinc400} />}
                label="Users w/ balance"
                value={overview.totalUsersWithBalance.toLocaleString("en-IN")}
                sub="non-zero rewardBalance"
              />
              <StatCard
                icon={<ArrowDownToLine size={14} color={colors.emerald400} />}
                label="Earned (30d)"
                value={overview.pointsEarnedLast30d.toLocaleString("en-IN")}
                sub="all EARNED_* rows"
              />
              <StatCard
                icon={<ArrowUpFromLine size={14} color="#7dd3fc" />}
                label="Redeemed (30d)"
                value={overview.pointsRedeemedLast30d.toLocaleString("en-IN")}
                sub="REDEEMED rows"
              />
            </View>

            <Pressable
              onPress={() => navigation.navigate("AdminRewardsDistribute")}
              style={({ pressed }) => [
                styles.cta,
                pressed && styles.ctaPressed,
              ]}
            >
              <View style={styles.ctaIcon}>
                <Sparkles size={18} color={colors.emerald400} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.ctaTitle}>Distribute points</Text>
                <Text style={styles.ctaSub}>
                  Pick users, set points + reason, grant
                </Text>
              </View>
              <ChevronRight size={18} color={colors.emerald400} />
            </Pressable>

            <Pressable
              onPress={() => navigation.navigate("AdminRewardsTransactions")}
              style={({ pressed }) => [
                styles.cta,
                pressed && styles.ctaPressed,
              ]}
            >
              <View style={styles.ctaIcon}>
                <ListOrdered size={18} color={colors.emerald400} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.ctaTitle}>Transactions ledger</Text>
                <Text style={styles.ctaSub}>
                  Every earn + redeem, filter by user / date / type
                </Text>
              </View>
              <ChevronRight size={18} color={colors.emerald400} />
            </Pressable>

            <Pressable
              onPress={() => navigation.navigate("AdminRewardsConfig")}
              style={({ pressed }) => [
                styles.cta,
                pressed && styles.ctaPressed,
              ]}
            >
              <View style={styles.ctaIcon}>
                <SlidersHorizontal size={18} color={colors.emerald400} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.ctaTitle}>Reward settings</Text>
                <Text style={styles.ctaSub}>
                  Earn rates, redemption rules, signup + referral bonuses
                </Text>
              </View>
              <ChevronRight size={18} color={colors.emerald400} />
            </Pressable>

            <View style={styles.statusRow}>
              <Text style={styles.statusText}>
                Engine:{" "}
                <Text
                  style={{
                    color: overview.enabled
                      ? colors.emerald400
                      : colors.warning,
                  }}
                >
                  {overview.enabled ? "Enabled" : "Paused"}
                </Text>
              </Text>
              <Text style={styles.statusText}>
                {overview.earnRateBookingBps / 100}% bookings ·{" "}
                {overview.earnRateCafeBps / 100}% cafe
              </Text>
            </View>
          </>
        ) : (
          <Text style={styles.errorText}>Couldn't load overview.</Text>
        )}

        <View style={styles.alertHeader}>
          <Text style={styles.sectionHeader}>Open alerts</Text>
          <Text style={styles.alertCount}>{alerts.length}</Text>
        </View>

        {alerts.length === 0 ? (
          <View style={styles.emptyCard}>
            <Check size={20} color={colors.emerald400} />
            <Text style={styles.emptyTitle}>All clear</Text>
            <Text style={styles.emptySub}>
              No open alerts. New ones surface here from inline + cron checks.
            </Text>
          </View>
        ) : (
          <View style={styles.alertsList}>
            {alerts.map((a) => (
              <AlertCard
                key={a.id}
                alert={a}
                pending={
                  updateAlertM.isPending && updateAlertM.variables?.id === a.id
                }
                onDismiss={() =>
                  updateAlertM.mutate({
                    id: a.id,
                    status: "DISMISSED",
                    resolution: "False positive",
                  })
                }
                onAction={() =>
                  updateAlertM.mutate({
                    id: a.id,
                    status: "ACTIONED",
                    resolution: "Reviewed and resolved",
                  })
                }
              />
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statHead}>
        {icon}
        <Text style={styles.statLabel}>{label}</Text>
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statSub}>{sub}</Text>
    </View>
  );
}

function AlertCard({
  alert,
  pending,
  onDismiss,
  onAction,
}: {
  alert: AdminAlertRow;
  pending: boolean;
  onDismiss: () => void;
  onAction: () => void;
}) {
  const tone = SEVERITY_TONE[alert.severity] ?? SEVERITY_TONE.LOW;
  return (
    <View style={styles.alertCard}>
      <View style={styles.alertTop}>
        <View
          style={[
            styles.severityChip,
            { backgroundColor: tone.bg, borderColor: tone.bg },
          ]}
        >
          <Text style={[styles.severityText, { color: tone.text }]}>
            {alert.severity}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.alertTitleRow}>
            <AlertTriangle size={14} color={colors.warning} />
            <Text style={styles.alertTitle}>
              {KIND_LABELS[alert.kind] ?? alert.kind}
            </Text>
          </View>
          <Text style={styles.alertSub}>
            {alert.user.name ?? "—"} · {alert.user.phone ?? alert.user.id}
          </Text>
        </View>
      </View>

      <View style={styles.alertActions}>
        <Pressable
          onPress={onDismiss}
          disabled={pending}
          style={({ pressed }) => [
            styles.alertBtn,
            styles.alertBtnSecondary,
            pressed && { opacity: 0.7 },
          ]}
        >
          <X size={12} color={colors.zinc300} />
          <Text style={styles.alertBtnSecondaryText}>Dismiss</Text>
        </Pressable>
        <Pressable
          onPress={onAction}
          disabled={pending}
          style={({ pressed }) => [
            styles.alertBtn,
            styles.alertBtnPrimary,
            pressed && { opacity: 0.85 },
          ]}
        >
          <Check size={12} color={colors.foreground} />
          <Text style={styles.alertBtnPrimaryText}>Mark actioned</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["6"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["8"],
    gap: spacing["3"],
  },
  heading: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.foreground,
  },
  subhead: {
    fontSize: 13,
    color: colors.zinc400,
    marginBottom: spacing["2"],
  },
  loadingBlock: {
    paddingVertical: spacing["8"],
    alignItems: "center",
  },
  errorText: {
    color: colors.destructive,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["2"],
  },
  statCard: {
    flexBasis: "48%",
    flexGrow: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["3"],
  },
  statHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.zinc500,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  statValue: {
    marginTop: 4,
    fontSize: 20,
    fontWeight: "700",
    color: colors.foreground,
  },
  statSub: {
    fontSize: 10,
    color: colors.zinc600,
  },
  cta: {
    marginTop: spacing["2"],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.emerald500_30,
    backgroundColor: colors.emerald500_10,
    padding: spacing["4"],
  },
  ctaPressed: {
    opacity: 0.85,
  },
  ctaIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.emerald500_20,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.foreground,
  },
  ctaSub: {
    marginTop: 2,
    fontSize: 12,
    color: colors.emerald400,
  },
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing["1"],
    paddingTop: spacing["1"],
  },
  statusText: {
    fontSize: 11,
    color: colors.zinc500,
  },
  alertHeader: {
    marginTop: spacing["4"],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.zinc400,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  alertCount: {
    fontSize: 12,
    color: colors.zinc400,
  },
  alertsList: {
    gap: spacing["2"],
  },
  alertCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["3"],
    gap: spacing["3"],
  },
  alertTop: {
    flexDirection: "row",
    gap: spacing["3"],
  },
  severityChip: {
    paddingHorizontal: spacing["2"],
    paddingVertical: 2,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  severityText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  alertTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  alertTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.foreground,
  },
  alertSub: {
    marginTop: 2,
    fontSize: 11,
    color: colors.zinc500,
  },
  alertActions: {
    flexDirection: "row",
    gap: spacing["2"],
  },
  alertBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing["3"],
    paddingVertical: 6,
    borderRadius: radius.md,
  },
  alertBtnSecondary: {
    borderWidth: 1,
    borderColor: colors.zinc700,
    backgroundColor: colors.zinc900,
  },
  alertBtnPrimary: {
    backgroundColor: colors.primaryHover,
  },
  alertBtnSecondaryText: {
    fontSize: 11,
    color: colors.zinc300,
  },
  alertBtnPrimaryText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.foreground,
  },
  emptyCard: {
    alignItems: "center",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    borderStyle: "dashed",
    backgroundColor: "rgba(24, 24, 27, 0.30)",
    paddingVertical: spacing["6"],
    paddingHorizontal: spacing["4"],
    gap: 4,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.foreground,
  },
  emptySub: {
    fontSize: 12,
    color: colors.zinc500,
    textAlign: "center",
  },
  // Distribute screen styles below
});
