import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, QrCode, Wallet } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { colors, radius, spacing } from "../../theme";
import {
  payShopOrderWithRazorpay,
  shopApi,
  shopOrderIsPayable,
  type ShopPaymentMethod,
} from "../../lib/shop";
import { formatRupees } from "../../lib/format";
import { useAuth } from "../../providers/AuthProvider";
import { ApiError } from "../../lib/api";
import type { ShopStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<ShopStackParamList, "ShopCheckout">;

const METHODS: Array<{
  id: ShopPaymentMethod;
  name: string;
  description: string;
  icon: typeof CreditCard;
}> = [
  {
    id: "RAZORPAY",
    name: "Pay online",
    description: "Cards / UPI / Netbanking — instant confirmation",
    icon: CreditCard,
  },
  {
    id: "UPI_QR",
    name: "UPI QR at venue",
    description: "Scan & pay when you arrive",
    icon: QrCode,
  },
  {
    id: "CASH",
    name: "Pay at venue",
    description: "Pay in cash when you collect",
    icon: Wallet,
  },
];

export function ShopCheckoutScreen() {
  const navigation = useNavigation<Nav>();
  const qc = useQueryClient();
  const { state } = useAuth();
  const signedInUser = state.status === "signedIn" ? state.user : null;

  const cartQuery = useQuery({
    queryKey: ["shop-cart"],
    queryFn: () => shopApi.getCart(),
  });

  const [method, setMethod] = useState<ShopPaymentMethod>("RAZORPAY");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cart = cartQuery.data?.cart ?? { lines: [], totalPaise: 0, itemCount: 0 };
  const availableLines = cart.lines.filter((l) => !l.unavailable);
  const totalRupees = Math.round(cart.totalPaise / 100);

  async function handleRazorpay(orderId: string) {
    const outcome = await payShopOrderWithRazorpay({
      orderId,
      themeColor: colors.primary,
      prefill: {
        name: signedInUser?.name ?? undefined,
        email: signedInUser?.email ?? undefined,
        contact: signedInUser?.phone ?? undefined,
      },
    });
    if (outcome === "paid") return;
    // User dismissed the sheet. placeOrder already drained the cart and
    // decremented stock, so this prompt is the fastest route back to a
    // payable sheet — the order detail screen carries the same pay action
    // for anyone who declines here.
    const retry = await new Promise<boolean>((resolve) => {
      Alert.alert(
        "Payment cancelled",
        "Your order is saved but unpaid. Retry now, or pay later from the order.",
        [
          {
            text: "Not now",
            style: "cancel",
            onPress: () => resolve(false),
          },
          { text: "Retry payment", onPress: () => resolve(true) },
        ],
        { cancelable: false },
      );
    });
    // Re-opening the sheet re-stamps the payment row's razorpayOrderId, so
    // only retry while the order is still payable — an order confirmed at
    // the counter meanwhile would come back from create-order as a 404.
    if (retry && (await shopOrderIsPayable(orderId))) {
      await handleRazorpay(orderId);
    }
  }

  async function handleConfirm() {
    if (availableLines.length === 0) {
      setError("Cart is empty");
      return;
    }
    setError(null);
    setProcessing(true);
    let placedOrderId: string | null = null;
    try {
      const place = await shopApi.placeOrder(method);
      placedOrderId = place.orderId;
      void qc.invalidateQueries({ queryKey: ["shop-cart"] });
      if (method === "RAZORPAY") {
        await handleRazorpay(place.orderId);
      }
      navigation.replace("ShopOrderDetail", { orderId: place.orderId });
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Checkout failed";
      // The order exists and the cart is gone the moment placeOrder returns,
      // so a payment-stage failure must still hand over the order — leaving
      // the customer on an empty checkout gives them no reference to a
      // payment that may well have been captured.
      if (placedOrderId) {
        const orderId = placedOrderId;
        setError(msg);
        Alert.alert(
          "Payment not confirmed",
          `${msg}\n\nYour order was placed. If money was debited, don't pay again — show this order at the front desk. Otherwise you can retry the payment from the order.`,
          [
            {
              text: "View order",
              onPress: () => navigation.replace("ShopOrderDetail", { orderId }),
            },
          ],
        );
        return;
      }
      setError(msg);
      Alert.alert("Checkout failed", msg);
    } finally {
      setProcessing(false);
    }
  }

  if (cartQuery.isLoading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text variant="title">Checkout</Text>
        <Text variant="small" color={colors.mutedForeground}>
          Pickup at venue. We&apos;ll text when it&apos;s ready.
        </Text>

        <Card style={styles.summary}>
          <Text variant="bodyStrong" style={{ marginBottom: spacing["2"] }}>
            Order summary
          </Text>
          {availableLines.map((line) => (
            <View key={line.productId} style={styles.summaryRow}>
              <Text variant="small" color={colors.zinc200}>
                {line.name} × {line.quantity}
              </Text>
              <Text variant="small" color={colors.zinc300}>
                {formatRupees(
                  Math.round((line.pricePaise * line.quantity) / 100),
                )}
              </Text>
            </View>
          ))}
          <View style={styles.divider} />
          <View style={styles.summaryRow}>
            <Text variant="bodyStrong">Total</Text>
            <Text variant="heading" weight="700" color={colors.emerald400}>
              {formatRupees(totalRupees)}
            </Text>
          </View>
        </Card>

        <View style={styles.methods}>
          <Text
            variant="tiny"
            color={colors.zinc500}
            style={styles.sectionLabel}
          >
            PAYMENT METHOD
          </Text>
          {METHODS.map((m) => {
            const selected = method === m.id;
            const Icon = m.icon;
            return (
              <Pressable
                key={m.id}
                onPress={() => setMethod(m.id)}
                style={({ pressed }) => [
                  styles.methodTile,
                  selected ? styles.methodTileSelected : null,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <View
                  style={[
                    styles.methodIcon,
                    selected && {
                      backgroundColor: colors.emerald500_10,
                    },
                  ]}
                >
                  <Icon
                    size={18}
                    color={selected ? colors.emerald400 : colors.zinc400}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text variant="small" weight="600" color={colors.foreground}>
                    {m.name}
                  </Text>
                  <Text variant="tiny" color={colors.zinc500}>
                    {m.description}
                  </Text>
                </View>
                <View
                  style={[
                    styles.radio,
                    selected && {
                      backgroundColor: colors.emerald400,
                      borderColor: colors.emerald400,
                    },
                  ]}
                />
              </Pressable>
            );
          })}
        </View>

        {error ? (
          <Card style={styles.errorBox}>
            <Text variant="small" color={colors.destructive}>
              {error}
            </Text>
          </Card>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label={
            method === "RAZORPAY"
              ? `Pay ${formatRupees(totalRupees)}`
              : method === "UPI_QR"
                ? "Place order — show QR"
                : "Place order — pay at venue"
          }
          onPress={handleConfirm}
          loading={processing}
          fullWidth
          size="lg"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["6"],
    gap: spacing["4"],
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  summary: {
    padding: spacing["4"],
    gap: spacing["1.5"],
  },
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
  methods: {
    gap: spacing["2"],
  },
  sectionLabel: {
    letterSpacing: 1.5,
    fontWeight: "700",
    marginBottom: spacing["1"],
  },
  methodTile: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    padding: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  methodTileSelected: {
    borderColor: colors.emerald400,
    backgroundColor: colors.emerald500_10,
  },
  methodIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.zinc800,
    alignItems: "center",
    justifyContent: "center",
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.zinc600,
  },
  errorBox: {
    padding: spacing["3"],
    borderColor: colors.destructive_30,
    backgroundColor: colors.destructive_10,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["6"],
    backgroundColor: colors.background,
  },
});
