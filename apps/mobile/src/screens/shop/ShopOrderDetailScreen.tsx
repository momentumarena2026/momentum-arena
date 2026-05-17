import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, QrCode, Wallet, X } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { colors, radius, spacing } from "../../theme";
import { shopApi } from "../../lib/shop";
import { formatRupees } from "../../lib/format";
// ShopOrderDetail is registered in BOTH stacks — ShopStack reaches it
// from the post-checkout success path, AccountStack reaches it from the
// orders list. The screen only calls `goBack()` on its navigator, so we
// declare a minimal param list rather than picking sides between the
// two parents (a union would force every caller to coerce).
type StackParams = { ShopOrderDetail: { orderId: string } };
type Nav = NativeStackNavigationProp<StackParams, "ShopOrderDetail">;
type Rt = RouteProp<StackParams, "ShopOrderDetail">;

const STATUS_TONE: Record<string, { bg: string; text: string }> = {
  PENDING: { bg: "rgba(234, 179, 8, 0.10)", text: "#facc15" },
  CONFIRMED: {
    bg: "rgba(16, 185, 129, 0.10)",
    text: "#34d399",
  },
  FULFILLED: {
    bg: "rgba(16, 185, 129, 0.10)",
    text: "#34d399",
  },
  CANCELLED: { bg: "rgba(239, 68, 68, 0.10)", text: "#f87171" },
  REFUNDED: { bg: "rgba(59, 130, 246, 0.10)", text: "#60a5fa" },
};

export function ShopOrderDetailScreen() {
  const route = useRoute<Rt>();
  const navigation = useNavigation<Nav>();
  const qc = useQueryClient();

  const orderQuery = useQuery({
    queryKey: ["shop-order", route.params.orderId],
    queryFn: () => shopApi.orderDetail(route.params.orderId),
  });

  const cancelMutation = useMutation({
    mutationFn: (reason: string) =>
      shopApi.cancelOrder(route.params.orderId, reason),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ["shop-order", route.params.orderId],
      });
      void qc.invalidateQueries({ queryKey: ["shop-cart"] });
    },
  });

  function handleCancel() {
    Alert.alert(
      "Cancel order?",
      "Your stock reservation will be released. This can't be undone.",
      [
        { text: "Keep order", style: "cancel" },
        {
          text: "Cancel order",
          style: "destructive",
          onPress: () =>
            cancelMutation.mutate("Cancelled by customer"),
        },
      ],
    );
  }

  if (orderQuery.isLoading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  if (orderQuery.isError || !orderQuery.data) {
    return (
      <Screen>
        <Card style={styles.errorCard}>
          <Text variant="bodyStrong" align="center">
            Couldn't load order
          </Text>
          <Button
            label="Back"
            onPress={() => navigation.goBack()}
            style={{ marginTop: spacing["4"] }}
          />
        </Card>
      </Screen>
    );
  }

  const order = orderQuery.data.order;
  const tone = STATUS_TONE[order.status] ?? STATUS_TONE.PENDING;
  const isPending = order.status === "PENDING";
  const isConfirmed = order.status === "CONFIRMED";
  const isFulfilled = order.status === "FULFILLED";
  const totalRupees = Math.round(order.totalPaise / 100);

  function statusBanner() {
    if (isFulfilled) {
      return (
        <BannerLine icon={CheckCircle2} tone="emerald">
          Picked up. Thanks!
        </BannerLine>
      );
    }
    if (isConfirmed) {
      return (
        <BannerLine icon={CheckCircle2} tone="emerald">
          Payment confirmed. Visit the front desk to collect.
        </BannerLine>
      );
    }
    if (order.status === "CANCELLED" || order.status === "REFUNDED") {
      return (
        <BannerLine icon={Clock} tone="red">
          Order {order.status.toLowerCase()}
          {order.cancelReason ? ` — ${order.cancelReason}` : ""}.
        </BannerLine>
      );
    }
    if (order.payment?.method === "RAZORPAY") {
      return (
        <BannerLine icon={Clock} tone="amber">
          Awaiting payment. Restart the Razorpay flow from your shop cart
          if you cancelled the popup.
        </BannerLine>
      );
    }
    if (order.payment?.method === "UPI_QR") {
      return (
        <BannerLine icon={QrCode} tone="amber">
          Scan the UPI QR at the counter and share the UTR with the
          attendant. We'll mark the order paid once verified.
        </BannerLine>
      );
    }
    return (
      <BannerLine icon={Wallet} tone="amber">
        Pay in cash at the venue when you collect.
      </BannerLine>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text variant="title">
              {order.orderNumber ?? `#${order.id.slice(-6).toUpperCase()}`}
            </Text>
            <Text variant="small" color={colors.zinc500}>
              {new Date(order.createdAt).toLocaleString("en-IN", {
                dateStyle: "long",
                timeStyle: "short",
                timeZone: "Asia/Kolkata",
              })}
            </Text>
          </View>
          <View
            style={[styles.statusPill, { backgroundColor: tone.bg }]}
          >
            <Text variant="tiny" weight="700" color={tone.text}>
              {order.status}
            </Text>
          </View>
        </View>

        <Card style={styles.bannerCard}>{statusBanner()}</Card>

        <Card style={styles.itemsCard}>
          <Text variant="bodyStrong" style={{ marginBottom: spacing["2"] }}>
            Items
          </Text>
          {order.items.map((line) => (
            <View key={line.id} style={styles.itemRow}>
              <View style={styles.itemThumb}>
                {line.product.imageUrl ? (
                  <Image
                    source={{ uri: line.product.imageUrl }}
                    style={styles.itemThumbImg}
                    resizeMode="cover"
                  />
                ) : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="small" weight="600" color={colors.foreground}>
                  {line.nameSnapshot}
                </Text>
                <Text variant="tiny" color={colors.zinc500}>
                  {formatRupees(Math.round(line.priceEachPaise / 100))} ×{" "}
                  {line.quantity}
                </Text>
              </View>
              <Text variant="small" weight="600" color={colors.emerald400}>
                {formatRupees(
                  Math.round((line.priceEachPaise * line.quantity) / 100),
                )}
              </Text>
            </View>
          ))}
          <View style={styles.divider} />
          <View style={styles.totalRow}>
            <Text variant="bodyStrong">Total</Text>
            <Text variant="heading" weight="700" color={colors.emerald400}>
              {formatRupees(totalRupees)}
            </Text>
          </View>
        </Card>

        <Card style={styles.paymentCard}>
          <Text variant="bodyStrong" style={{ marginBottom: spacing["2"] }}>
            Payment
          </Text>
          <RowKv label="Method" value={paymentLabel(order.payment?.method)} />
          <RowKv label="Status" value={order.payment?.status ?? "—"} />
          {order.payment?.razorpayPaymentId ? (
            <RowKv
              label="Razorpay ID"
              value={order.payment.razorpayPaymentId}
              mono
            />
          ) : null}
          {order.payment?.utrNumber ? (
            <RowKv label="UTR" value={order.payment.utrNumber} mono />
          ) : null}
        </Card>

        {isPending ? (
          <Button
            label="Cancel order"
            variant="ghost"
            onPress={handleCancel}
            loading={cancelMutation.isPending}
            leadingIcon={<X size={16} color={colors.destructive} />}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function RowKv({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <View style={styles.kvRow}>
      <Text variant="small" color={colors.zinc500}>
        {label}
      </Text>
      <Text
        variant="small"
        color={colors.zinc200}
        style={mono ? styles.monoValue : undefined}
      >
        {value}
      </Text>
    </View>
  );
}

function BannerLine({
  icon: Icon,
  tone,
  children,
}: {
  icon: typeof CheckCircle2;
  tone: "emerald" | "amber" | "red";
  children: string;
}) {
  const color =
    tone === "emerald"
      ? colors.emerald400
      : tone === "amber"
        ? colors.yellow400
        : colors.destructive;
  return (
    <View style={styles.bannerLine}>
      <Icon size={16} color={color} />
      <Text variant="small" color={color} style={{ flex: 1 }}>
        {children}
      </Text>
    </View>
  );
}

function paymentLabel(method: string | undefined | null): string {
  if (!method) return "—";
  if (method === "UPI_QR") return "UPI QR";
  return method.charAt(0) + method.slice(1).toLowerCase();
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["10"],
    gap: spacing["4"],
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  errorCard: {
    marginTop: spacing["10"],
    padding: spacing["6"],
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing["3"],
  },
  statusPill: {
    paddingHorizontal: spacing["3"],
    paddingVertical: 4,
    borderRadius: 999,
  },
  bannerCard: {
    padding: spacing["3"],
  },
  bannerLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  itemsCard: {
    padding: spacing["4"],
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    paddingVertical: spacing["2"],
  },
  itemThumb: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.zinc800,
  },
  itemThumbImg: {
    width: "100%",
    height: "100%",
  },
  divider: {
    height: 1,
    backgroundColor: colors.zinc800,
    marginVertical: spacing["2"],
  },
  totalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing["1"],
  },
  paymentCard: {
    padding: spacing["4"],
  },
  kvRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  monoValue: {
    fontFamily: "Menlo",
    fontSize: 11,
  },
});
