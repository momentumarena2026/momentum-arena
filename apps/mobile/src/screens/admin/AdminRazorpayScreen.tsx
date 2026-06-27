import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  Clock,
  IndianRupee,
  TrendingUp,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import { formatRupees } from "../../lib/format";
import {
  adminRazorpayApi,
  type AdminRazorpayOverview,
} from "../../lib/admin-razorpay";

/** Razorpay amounts arrive in PAISE — divide by 100 before formatting. */
function paiseToRupees(paise: number): string {
  return formatRupees(Math.round(paise) / 100);
}

const KPIS: {
  key: keyof Pick<
    AdminRazorpayOverview,
    "totalCollected" | "totalRefunded" | "netRevenue" | "pendingSettlements"
  >;
  label: string;
  icon: typeof IndianRupee;
  color: string;
}[] = [
  { key: "totalCollected", label: "Total Collected", icon: IndianRupee, color: colors.emerald400 },
  { key: "totalRefunded", label: "Total Refunded", icon: ArrowDownLeft, color: colors.destructive },
  { key: "netRevenue", label: "Net Revenue", icon: TrendingUp, color: colors.foreground },
  { key: "pendingSettlements", label: "Pending Settlements", icon: Clock, color: colors.yellow400 },
];

export function AdminRazorpayScreen() {
  const query = useQuery({
    queryKey: ["admin", "razorpay-overview"],
    queryFn: () => adminRazorpayApi.overview(),
  });

  const overview = query.data?.overview;
  const methods = overview
    ? Object.entries(overview.paymentMethodBreakdown).sort((a, b) => b[1] - a[1])
    : [];
  const methodMax = methods.reduce((m, [, v]) => Math.max(m, v), 0);

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching && !query.isLoading}
            onRefresh={() => void query.refetch()}
            tintColor={colors.zinc400}
          />
        }
      >
        <Text variant="tiny" color={colors.zinc500} style={styles.caption}>
          Last 100 transactions · past 30 days
        </Text>

        {query.isLoading ? (
          <View style={styles.kpiGrid}>
            {[0, 1, 2, 3].map((i) => (
              <Card key={i} style={styles.kpiCard}>
                <Skeleton width={28} height={28} />
                <Skeleton width="80%" height={20} />
                <Skeleton width="60%" height={12} />
              </Card>
            ))}
          </View>
        ) : query.isError ? (
          <Card style={styles.card}>
            <Text variant="small" color={colors.destructive}>
              {query.error instanceof Error
                ? query.error.message
                : "Couldn't load the Razorpay overview."}
            </Text>
          </Card>
        ) : overview?.error ? (
          <Card style={styles.card}>
            <Text variant="small" color={colors.destructive}>
              {overview.error}
            </Text>
          </Card>
        ) : overview ? (
          <>
            <View style={styles.kpiGrid}>
              {KPIS.map((kpi) => {
                const Icon = kpi.icon;
                return (
                  <Card key={kpi.key} style={styles.kpiCard}>
                    <Icon size={20} color={kpi.color} />
                    <Text variant="title" weight="700" color={colors.foreground}>
                      {paiseToRupees(overview[kpi.key])}
                    </Text>
                    <Text variant="tiny" color={colors.zinc500}>
                      {kpi.label}
                    </Text>
                  </Card>
                );
              })}
            </View>

            <Text variant="tiny" color={colors.zinc500} style={styles.section}>
              PAYMENT METHODS
            </Text>
            <Card style={styles.card}>
              {methods.length === 0 ? (
                <Text variant="small" color={colors.zinc500}>
                  No captured payments in this window.
                </Text>
              ) : (
                methods.map(([m, amount]) => (
                  <View key={m} style={styles.methodRow}>
                    <View style={styles.methodHead}>
                      <Text variant="small" weight="500" color={colors.foreground}>
                        {m}
                      </Text>
                      <Text variant="small" color={colors.zinc400}>
                        {paiseToRupees(amount)}
                      </Text>
                    </View>
                    <View style={styles.barTrack}>
                      <View
                        style={[
                          styles.barFill,
                          { width: `${methodMax > 0 ? (amount / methodMax) * 100 : 0}%` },
                        ]}
                      />
                    </View>
                  </View>
                ))
              )}
            </Card>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["4"],
    paddingBottom: spacing["10"],
    gap: spacing["2"],
  },
  caption: { marginBottom: spacing["1"] },
  card: { padding: spacing["4"], gap: spacing["3"] },
  section: { letterSpacing: 1.2, fontWeight: "700", marginTop: spacing["3"] },
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["3"],
  },
  kpiCard: {
    flexGrow: 1,
    flexBasis: "47%",
    padding: spacing["4"],
    gap: spacing["2"],
  },
  methodRow: { gap: spacing["1.5"] },
  methodHead: { flexDirection: "row", justifyContent: "space-between" },
  barTrack: {
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.zinc800,
    overflow: "hidden",
  },
  barFill: {
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.emerald400,
  },
});
