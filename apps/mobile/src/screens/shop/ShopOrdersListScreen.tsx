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
import { ChevronRight, ShoppingBag } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { colors, radius, spacing } from "../../theme";
import { shopApi, type ProductOrderStatus } from "../../lib/shop";
import { formatRupees } from "../../lib/format";
import type { ShopStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<ShopStackParamList, "ShopOrders">;

const STATUS_TONE: Record<ProductOrderStatus, { bg: string; text: string }> = {
  PENDING: { bg: "rgba(234, 179, 8, 0.10)", text: "#facc15" },
  CONFIRMED: { bg: "rgba(16, 185, 129, 0.10)", text: "#34d399" },
  FULFILLED: { bg: "rgba(16, 185, 129, 0.10)", text: "#34d399" },
  CANCELLED: { bg: "rgba(239, 68, 68, 0.10)", text: "#f87171" },
  REFUNDED: { bg: "rgba(59, 130, 246, 0.10)", text: "#60a5fa" },
};

/**
 * Customer's shop order history. Mirrors the web /shop/orders page:
 * paginated list of past + in-flight orders, each tappable into the
 * existing ShopOrderDetailScreen.
 */
export function ShopOrdersListScreen() {
  const navigation = useNavigation<Nav>();

  const ordersQuery = useQuery({
    queryKey: ["shop-orders"],
    queryFn: () => shopApi.myOrders(),
  });

  if (ordersQuery.isLoading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  const orders = ordersQuery.data?.orders ?? [];

  if (orders.length === 0) {
    return (
      <Screen>
        <Card style={styles.emptyCard}>
          <View style={styles.emptyIcon}>
            <ShoppingBag size={28} color={colors.emerald400} />
          </View>
          <Text variant="bodyStrong" align="center">
            No shop orders yet
          </Text>
          <Text
            variant="small"
            color={colors.mutedForeground}
            align="center"
            style={{ marginTop: spacing["1"] }}
          >
            Anything you buy from the venue shop will show up here.
          </Text>
          <Button
            label="Browse shop"
            onPress={() => navigation.navigate("ShopHome")}
            style={{ marginTop: spacing["4"] }}
            fullWidth
          />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {orders.map((order) => {
          const itemCount = order.items.reduce(
            (s, i) => s + i.quantity,
            0,
          );
          const tone = STATUS_TONE[order.status] ?? STATUS_TONE.PENDING;
          return (
            <Pressable
              key={order.id}
              onPress={() =>
                navigation.navigate("ShopOrderDetail", { orderId: order.id })
              }
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.headerRow}>
                  <Text
                    variant="small"
                    weight="700"
                    color={colors.emerald400}
                    style={styles.orderNumber}
                  >
                    {order.orderNumber ??
                      `#${order.id.slice(-6).toUpperCase()}`}
                  </Text>
                  <View style={[styles.statusPill, { backgroundColor: tone.bg }]}>
                    <Text variant="tiny" weight="700" color={tone.text}>
                      {order.status}
                    </Text>
                  </View>
                </View>
                <Text
                  variant="tiny"
                  color={colors.zinc500}
                  style={{ marginTop: 2 }}
                >
                  {itemCount} item{itemCount === 1 ? "" : "s"} ·{" "}
                  {new Date(order.createdAt).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    timeZone: "Asia/Kolkata",
                  })}
                </Text>
              </View>
              <View style={styles.right}>
                <Text variant="small" weight="700" color={colors.emerald400}>
                  {formatRupees(Math.round(order.totalPaise / 100))}
                </Text>
                <ChevronRight size={14} color={colors.zinc600} />
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["8"],
    gap: spacing["2"],
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyCard: {
    marginTop: spacing["10"],
    padding: spacing["6"],
    alignItems: "center",
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 999,
    backgroundColor: colors.emerald500_10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing["3"],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    padding: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  orderNumber: {
    fontVariant: ["tabular-nums"],
  },
  statusPill: {
    paddingHorizontal: spacing["2"],
    paddingVertical: 2,
    borderRadius: 999,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1.5"],
  },
});
