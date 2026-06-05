import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  CheckCircle2,
  ChefHat,
  Clock,
  Hourglass,
  XCircle,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { colors, radius, spacing } from "../../theme";
import { cafeApi, type CafeOrderStatus } from "../../lib/cafe";
import { formatRupees } from "../../lib/format";
import type {
  CafeStackParamList,
  AccountStackParamList,
} from "../../navigation/types";

type CafeNav = NativeStackNavigationProp<CafeStackParamList, "CafeOrderDetail">;
type AccountNav = NativeStackNavigationProp<
  AccountStackParamList,
  "CafeOrderDetail"
>;
type Nav = CafeNav | AccountNav;
type Route = RouteProp<CafeStackParamList, "CafeOrderDetail">;

const STATUS_META: Record<
  CafeOrderStatus,
  { label: string; icon: typeof Clock; color: string; bg: string; sub?: string }
> = {
  PENDING_PAYMENT: {
    label: "Payment in progress",
    icon: Hourglass,
    color: colors.zinc300,
    bg: "rgba(63,63,70,0.4)",
    sub: "Waiting for the payment gateway to confirm.",
  },
  PENDING: {
    label: "Order received",
    icon: Clock,
    color: colors.warning,
    bg: "rgba(250,204,21,0.10)",
    sub: "Kitchen will pick it up shortly.",
  },
  PREPARING: {
    label: "In the kitchen",
    icon: ChefHat,
    color: "#60a5fa",
    bg: "rgba(96,165,250,0.10)",
    sub: "Your order is being prepared.",
  },
  READY: {
    label: "Ready for pickup",
    icon: Bell,
    color: "#c084fc",
    bg: "rgba(192,132,252,0.10)",
    sub: "Head to the counter — your order is ready.",
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

export function CafeOrderDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { orderId } = route.params;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["cafe", "order", orderId],
    queryFn: () => cafeApi.orderDetail(orderId),
    refetchInterval: 15_000, // poll every 15s so kitchen progress is visible
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
            Couldn&apos;t load this order.
          </Text>
          <Button label="Retry" onPress={() => refetch()} variant="secondary" />
        </View>
      </Screen>
    );
  }

  const order = data.order;
  const meta = STATUS_META[order.status as CafeOrderStatus] ?? STATUS_META.PENDING;
  const Icon = meta.icon;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text variant="tiny" color={colors.zinc500}>
              Order
            </Text>
            <Text variant="title" weight="700" color={colors.foreground}>
              {order.orderNumber}
            </Text>
            <Text variant="tiny" color={colors.zinc500}>
              {new Date(order.createdAt).toLocaleString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Text>
          </View>
          <View
            style={[
              styles.statusPill,
              { backgroundColor: meta.bg, borderColor: meta.color },
            ]}
          >
            <Icon size={14} color={meta.color} />
            <Text variant="tiny" weight="700" color={meta.color}>
              {meta.label}
            </Text>
          </View>
        </View>

        {meta.sub ? (
          <Text variant="small" color={colors.zinc400} style={styles.statusSub}>
            {meta.sub}
          </Text>
        ) : null}

        <Card style={styles.card}>
          <Text variant="bodyStrong" style={{ marginBottom: spacing["2"] }}>
            Items
          </Text>
          {order.items.map((line) => (
            <View key={line.id} style={styles.itemRow}>
              <View
                style={[
                  styles.vegBadge,
                  {
                    borderColor: line.isVeg
                      ? "rgba(16,185,129,0.5)"
                      : "rgba(239,68,68,0.5)",
                  },
                ]}
              >
                <View
                  style={[
                    styles.vegDot,
                    {
                      backgroundColor: line.isVeg
                        ? colors.emerald400
                        : colors.destructive,
                    },
                  ]}
                />
              </View>
              <Text variant="small" color={colors.zinc300} style={{ flex: 1 }}>
                {line.itemName}
              </Text>
              <Text variant="small" color={colors.zinc400}>
                × {line.quantity}
              </Text>
              <Text variant="small" weight="600" color={colors.zinc300}>
                {formatRupees(line.totalPrice)}
              </Text>
            </View>
          ))}
        </Card>

        <Card style={styles.card}>
          <Text variant="bodyStrong" style={{ marginBottom: spacing["2"] }}>
            Payment
          </Text>
          {order.originalAmount && order.discountAmount > 0 ? (
            <>
              <View style={styles.summaryRow}>
                <Text variant="small" color={colors.zinc400}>
                  Subtotal
                </Text>
                <Text variant="small" color={colors.zinc300}>
                  {formatRupees(order.originalAmount)}
                </Text>
              </View>
              <View style={styles.summaryRow}>
                <Text variant="small" color={colors.zinc400}>
                  Discount
                </Text>
                <Text variant="small" color={colors.warning}>
                  − {formatRupees(order.discountAmount)}
                </Text>
              </View>
              <View style={styles.divider} />
            </>
          ) : null}
          <View style={styles.summaryRow}>
            <Text variant="bodyStrong">Total</Text>
            <Text variant="heading" weight="700" color={colors.emerald400}>
              {formatRupees(order.totalAmount)}
            </Text>
          </View>
          {order.payment ? (
            <View style={[styles.summaryRow, { marginTop: spacing["2"] }]}>
              <Text variant="tiny" color={colors.zinc500}>
                {labelPaymentMethod(order.payment.method)} ·{" "}
                {order.payment.status}
              </Text>
              {order.payment.confirmedAt ? (
                <Text variant="tiny" color={colors.zinc500}>
                  Paid {new Date(order.payment.confirmedAt).toLocaleTimeString(
                    "en-IN",
                    { hour: "2-digit", minute: "2-digit" },
                  )}
                </Text>
              ) : null}
            </View>
          ) : null}
        </Card>

        {order.note ? (
          <Card style={styles.card}>
            <Text variant="tiny" color={colors.zinc500}>
              NOTE
            </Text>
            <Text variant="small" color={colors.zinc300}>
              {order.note}
            </Text>
          </Card>
        ) : null}

        <Button
          label="Back"
          variant="secondary"
          // Pop the current screen — works whether we landed here from
          // CafeStack (post-checkout success) or AccountStack (orders
          // list drill-down). Avoids assuming which parent navigator
          // mounted us.
          onPress={() => navigation.goBack()}
          fullWidth
        />
      </ScrollView>
    </Screen>
  );
}

function labelPaymentMethod(m: string) {
  switch (m) {
    case "RAZORPAY":
      return "Razorpay (online)";
    case "PHONEPE":
      return "PhonePe";
    case "UPI_QR":
      return "UPI QR (counter)";
    case "CASH":
      return "Cash (counter)";
    default:
      return m;
  }
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
    paddingBottom: spacing["8"],
    gap: spacing["3"],
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing["3"],
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1.5"],
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["1.5"],
    borderRadius: 999,
    borderWidth: 1,
  },
  statusSub: { paddingBottom: spacing["1"] },
  card: { padding: spacing["4"], gap: spacing["1.5"] },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    paddingVertical: 4,
  },
  vegBadge: {
    width: 12,
    height: 12,
    borderRadius: 3,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  vegDot: { width: 5, height: 5, borderRadius: 3 },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  divider: {
    height: 1,
    backgroundColor: colors.zinc800,
    marginVertical: spacing["2"],
  },
});
