import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  CheckCircle2,
  ChefHat,
  Clock,
  Coffee,
  Hourglass,
  XCircle,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { colors, radius, spacing } from "../../theme";
import { cafeApi, type CafeOrderStatus } from "../../lib/cafe";
import { formatRupees } from "../../lib/format";
import type { AccountStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<AccountStackParamList, "CafeOrders">;

const STATUS_PILL: Record<
  CafeOrderStatus,
  { label: string; icon: typeof Clock; color: string; bg: string }
> = {
  PENDING_PAYMENT: {
    label: "Payment",
    icon: Hourglass,
    color: colors.zinc300,
    bg: "rgba(63,63,70,0.4)",
  },
  PENDING: {
    label: "Received",
    icon: Clock,
    color: colors.warning,
    bg: "rgba(250,204,21,0.10)",
  },
  PREPARING: {
    label: "Preparing",
    icon: ChefHat,
    color: "#60a5fa",
    bg: "rgba(96,165,250,0.10)",
  },
  READY: {
    label: "Ready",
    icon: Bell,
    color: "#c084fc",
    bg: "rgba(192,132,252,0.10)",
  },
  COMPLETED: {
    label: "Completed",
    icon: CheckCircle2,
    color: colors.emerald400,
    bg: "rgba(16,185,129,0.10)",
  },
  CANCELLED: {
    label: "Cancelled",
    icon: XCircle,
    color: colors.destructive_300,
    bg: "rgba(239,68,68,0.10)",
  },
};

/**
 * Cafe order history under the Account tab. Polls every 30s so
 * status flips from the kitchen (PENDING → PREPARING → READY →
 * COMPLETED) reflect without a manual pull-to-refresh.
 */
export function CafeOrdersListScreen() {
  const navigation = useNavigation<Nav>();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["cafe", "myOrders"],
    queryFn: () => cafeApi.myOrders(),
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.warning} />
        </View>
      </Screen>
    );
  }

  if (isError || !data) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text variant="body" color={colors.destructive_300}>
            Couldn&apos;t load orders.
          </Text>
          <Button label="Retry" onPress={() => refetch()} variant="secondary" />
        </View>
      </Screen>
    );
  }

  const orders = data.orders;

  if (orders.length === 0) {
    return (
      <Screen>
        <View style={styles.center}>
          <Coffee size={48} color={colors.zinc600} />
          <Text variant="title" weight="700" color={colors.foreground}>
            No orders yet
          </Text>
          <Text variant="small" color={colors.zinc500} align="center">
            When you place an order from the cafe, it&apos;ll show up here.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text variant="title" weight="700" color={colors.foreground}>
          My Cafe Orders
        </Text>
        <Text variant="small" color={colors.zinc500}>
          Everything you&apos;ve ordered from the cafe.
        </Text>

        <View style={styles.list}>
          {orders.map((o) => {
            const meta =
              STATUS_PILL[o.status as CafeOrderStatus] ?? STATUS_PILL.PENDING;
            const Icon = meta.icon;
            return (
              <Pressable
                key={o.id}
                onPress={() =>
                  navigation.navigate("CafeOrderDetail", { orderId: o.id })
                }
                style={({ pressed }) => [
                  styles.row,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <View style={styles.rowHeader}>
                  <Text
                    variant="bodyStrong"
                    color={colors.foreground}
                    style={{ flex: 1 }}
                  >
                    {o.orderNumber}
                  </Text>
                  <View
                    style={[
                      styles.statusPill,
                      { backgroundColor: meta.bg, borderColor: meta.color },
                    ]}
                  >
                    <Icon size={12} color={meta.color} />
                    <Text variant="tiny" weight="700" color={meta.color}>
                      {meta.label}
                    </Text>
                  </View>
                </View>
                <Text variant="tiny" color={colors.zinc500}>
                  {new Date(o.createdAt).toLocaleString("en-IN", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
                <Text
                  variant="tiny"
                  color={colors.zinc400}
                  numberOfLines={1}
                  style={{ marginTop: 4 }}
                >
                  {o.items
                    .slice(0, 3)
                    .map((l) => `${l.itemName} × ${l.quantity}`)
                    .join(", ")}
                  {o.items.length > 3 ? ` +${o.items.length - 3}` : ""}
                </Text>
                <View style={styles.rowFooter}>
                  <Text variant="small" weight="700" color={colors.emerald400}>
                    {formatRupees(o.totalAmount)}
                  </Text>
                  <Text variant="tiny" color={colors.zinc500}>
                    {o.items.length} item{o.items.length !== 1 ? "s" : ""}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing["3"],
    padding: spacing["6"],
  },
  scroll: {
    padding: spacing["4"],
    paddingBottom: spacing["10"],
    gap: spacing["2"],
  },
  list: { gap: spacing["2"], marginTop: spacing["2"] },
  row: {
    padding: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.card,
    gap: 2,
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    marginBottom: 2,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing["2"],
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  rowFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing["2"],
  },
});
