import { RefreshControl, ScrollView, StyleSheet, View, Pressable } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarCheck,
  CalendarPlus,
  Coffee,
  IndianRupee,
  ScanLine,
  Users,
  Wallet,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import { adminDashboardApi } from "../../lib/admin-dashboard";
import { formatRupees } from "../../lib/format";
import type { AdminTabsParamList } from "../../navigation/types";

type Nav = BottomTabNavigationProp<AdminTabsParamList, "AdminHome">;

export function AdminDashboardScreen() {
  const navigation = useNavigation<Nav>();
  // RN's typed navigate chokes on cross-navigator jumps; a minimal call
  // signature keeps the quick-actions clean (route names authored below).
  const go = navigation as unknown as {
    navigate: (name: string, params?: object) => void;
  };
  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: () => adminDashboardApi.stats(),
  });

  const s = data?.stats;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching && !isLoading}
            onRefresh={() => void refetch()}
            tintColor={colors.zinc400}
          />
        }
      >
        {/* KPI grid */}
        <View style={styles.grid}>
          <Kpi
            label="Today's bookings"
            value={s ? String(s.todayBookings) : undefined}
            icon={<CalendarCheck size={18} color={colors.yellow400} />}
            loading={isLoading}
          />
          <Kpi
            label="Today's earning"
            value={s ? formatRupees(s.todayEarning) : undefined}
            icon={<IndianRupee size={18} color={colors.emerald400} />}
            loading={isLoading}
            accent={colors.emerald400}
          />
          <Kpi
            label="Total bookings"
            value={s ? String(s.totalBookings) : undefined}
            icon={<CalendarCheck size={18} color={colors.zinc300} />}
            loading={isLoading}
          />
          <Kpi
            label="Active users"
            value={s ? String(s.totalUsers) : undefined}
            icon={<Users size={18} color={colors.zinc300} />}
            loading={isLoading}
          />
          <Kpi
            label="Pending payments"
            value={s ? String(s.pendingPayments) : undefined}
            icon={<Wallet size={18} color={colors.warning} />}
            loading={isLoading}
            accent={s && s.pendingPayments > 0 ? colors.warning : undefined}
          />
          <Kpi
            label="Due at venue"
            value={s ? formatRupees(s.venueDueTotal) : undefined}
            icon={<Wallet size={18} color={colors.zinc300} />}
            loading={isLoading}
          />
        </View>

        {/* Quick actions */}
        <Text variant="tiny" color={colors.zinc500} style={styles.sectionLabel}>
          QUICK ACTIONS
        </Text>
        <View style={styles.actionsRow}>
          <QuickAction
            icon={<ScanLine size={20} color={colors.yellow400} />}
            label="Check-in"
            onPress={() => go.navigate("AdminCheckin")}
          />
          <QuickAction
            icon={<CalendarPlus size={20} color={colors.emerald400} />}
            label="New booking"
            onPress={() =>
              go.navigate("AdminBookings", { screen: "AdminCreateBooking" })
            }
          />
          <QuickAction
            icon={<Coffee size={20} color="#fcd34d" />}
            label="Cafe orders"
            onPress={() => go.navigate("AdminCafe")}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

function Kpi({
  label,
  value,
  icon,
  loading,
  accent,
}: {
  label: string;
  value?: string;
  icon: React.ReactNode;
  loading: boolean;
  accent?: string;
}) {
  return (
    <Card style={styles.kpiCard}>
      <View style={styles.kpiHead}>
        {icon}
      </View>
      {loading || value === undefined ? (
        <Skeleton width={70} height={22} />
      ) : (
        <Text variant="heading" weight="700" color={accent ?? colors.foreground}>
          {value}
        </Text>
      )}
      <Text variant="tiny" color={colors.zinc500}>
        {label}
      </Text>
    </Card>
  );
}

function QuickAction({
  icon,
  label,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.actionIcon}>{icon}</View>
      <Text variant="tiny" weight="600" color={colors.zinc300}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["4"],
    paddingBottom: spacing["10"],
    gap: spacing["4"],
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["3"],
  },
  kpiCard: {
    flexBasis: "47%",
    flexGrow: 1,
    padding: spacing["4"],
    gap: spacing["1"],
  },
  kpiHead: { marginBottom: spacing["1"] },
  sectionLabel: {
    letterSpacing: 1.5,
    fontWeight: "700",
    marginTop: spacing["2"],
  },
  actionsRow: { flexDirection: "row", gap: spacing["3"] },
  action: {
    flex: 1,
    alignItems: "center",
    gap: spacing["2"],
    paddingVertical: spacing["4"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.zinc800,
  },
});
