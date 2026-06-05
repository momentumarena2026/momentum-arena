import { useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import RazorpayCheckout from "react-native-razorpay";
import type {
  PaymentErrorData,
  PaymentSuccessData,
} from "react-native-razorpay/src/types";
import { CreditCard, QrCode, Wallet } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { colors, radius, spacing } from "../../theme";
import { useCafeCart } from "../../providers/CafeCartProvider";
import { useAuth } from "../../providers/AuthProvider";
import {
  cafeApi,
  type CafePaymentMethod,
} from "../../lib/cafe";
import { formatRupees } from "../../lib/format";
import { ApiError } from "../../lib/api";
import type { CafeStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<CafeStackParamList, "CafeCheckout">;

const METHODS: Array<{
  id: CafePaymentMethod;
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
    name: "UPI QR at counter",
    description: "Scan & pay when you arrive",
    icon: QrCode,
  },
  {
    id: "CASH",
    name: "Pay at counter",
    description: "Pay in cash when you collect",
    icon: Wallet,
  },
];

/**
 * Cafe checkout — mirrors the shop checkout shape. For RAZORPAY:
 * server returns a CafePaymentIntent id; we open the native modal,
 * verify on success → server materialises the real CafeOrder and
 * returns its id, which we navigate to. Modal dismiss / failure →
 * call cafe-cancel so the intent is deleted (no CafeOrder ever
 * gets created for an abandoned payment). For CASH / UPI_QR: order
 * lands immediately, navigate straight to detail.
 */
export function CafeCheckoutScreen() {
  const navigation = useNavigation<Nav>();
  const cart = useCafeCart();
  const { state } = useAuth();
  const signedInUser = state.status === "signedIn" ? state.user : null;

  const [method, setMethod] = useState<CafePaymentMethod>("RAZORPAY");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (cart.lines.length === 0) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text variant="small" color={colors.zinc500}>
            Cart is empty.
          </Text>
        </View>
      </Screen>
    );
  }

  async function handleConfirm() {
    setError(null);
    setProcessing(true);
    try {
      const orderRes = await cafeApi.createOrder({
        items: cart.lines.map((l) => ({
          cafeItemId: l.cafeItemId,
          quantity: l.quantity,
        })),
        paymentMethod: method,
      });

      // In-person path — order is real, navigate straight to detail.
      if (!orderRes.intent) {
        cart.clear();
        navigation.replace("CafeOrderDetail", { orderId: orderRes.orderId });
        return;
      }

      // RAZORPAY — initiate gateway with the intent id.
      const intentId = orderRes.orderId;
      const init = await cafeApi.razorpayCreateOrder(intentId);

      let success: PaymentSuccessData;
      try {
        success = (await RazorpayCheckout.open({
          key: init.keyId,
          amount: Math.round(init.amount * 100), // SDK wants paise
          currency: init.currency,
          name: "Momentum Arena",
          description: "Cafe order",
          order_id: init.razorpayOrderId,
          prefill: {
            // Razorpay's prefill fields are typed as strict `string`
            // — `?? ""` keeps the runtime behaviour ("don't pre-fill")
            // while satisfying the type. Same workaround the shop
            // checkout uses below in the same file structure.
            name: signedInUser?.name ?? "",
            email: signedInUser?.email ?? "",
            contact: signedInUser?.phone ?? "",
          },
          theme: { color: colors.warning },
        })) as PaymentSuccessData;
      } catch (err) {
        const e = err as PaymentErrorData;
        if (
          e?.code === 2 ||
          e?.description?.toLowerCase().includes("cancel")
        ) {
          // User dismissed — best-effort delete the intent so it
          // doesn't linger in the DB. No order was created so the
          // customer just stays on this screen.
          await cafeApi.razorpayCancel(intentId).catch(() => undefined);
          setError("Payment cancelled.");
          return;
        }
        // Hard failure — same cleanup as dismiss; surface the
        // gateway's reason if any.
        await cafeApi.razorpayCancel(intentId).catch(() => undefined);
        throw new Error(e?.description || "Payment failed");
      }

      // `PaymentSuccessData` types its fields as `string | undefined`
      // even though the SDK only resolves the success promise when
      // all three values are present. Coerce with `?? ""` so the
      // verify call's strict-string types are satisfied — server
      // rejects empty strings as missing-signature, which lands the
      // customer back on this screen with an error.
      const verify = await cafeApi.razorpayVerify({
        orderId: intentId,
        razorpayPaymentId: success.razorpay_payment_id ?? "",
        razorpayOrderId: success.razorpay_order_id ?? "",
        razorpaySignature: success.razorpay_signature ?? "",
      });

      cart.clear();
      navigation.replace("CafeOrderDetail", { orderId: verify.orderId });
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Checkout failed";
      setError(msg);
      Alert.alert("Checkout failed", msg);
    } finally {
      setProcessing(false);
    }
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text variant="title" weight="700">
          Checkout
        </Text>
        <Text variant="small" color={colors.zinc500}>
          Pick up at the cafe counter. We&apos;ll text when it&apos;s ready.
        </Text>

        <Card style={styles.summary}>
          <Text variant="bodyStrong" style={{ marginBottom: spacing["2"] }}>
            Order summary
          </Text>
          {cart.lines.map((line) => (
            <View key={line.cafeItemId} style={styles.summaryRow}>
              <Text variant="small" color={colors.zinc300} style={{ flex: 1 }}>
                {line.name} × {line.quantity}
              </Text>
              <Text variant="small" color={colors.zinc300}>
                {formatRupees(line.price * line.quantity)}
              </Text>
            </View>
          ))}
          <View style={styles.divider} />
          <View style={styles.summaryRow}>
            <Text variant="bodyStrong">Total</Text>
            <Text variant="heading" weight="700" color={colors.emerald400}>
              {formatRupees(cart.subtotal)}
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
                    selected && { backgroundColor: colors.emerald500_10 },
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
              ? `Pay ${formatRupees(cart.subtotal)}`
              : method === "UPI_QR"
                ? "Place order — show QR"
                : "Place order — pay at counter"
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
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  summary: { padding: spacing["4"], gap: spacing["1.5"] },
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
  methods: { gap: spacing["2"] },
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
