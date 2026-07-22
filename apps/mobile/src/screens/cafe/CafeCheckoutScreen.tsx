import { useEffect, useRef, useState } from "react";
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
import { Input } from "../../components/ui/Input";
import { colors, radius, spacing } from "../../theme";
import { useCafeCart } from "../../providers/CafeCartProvider";
import { useAuth } from "../../providers/AuthProvider";
import {
  cafeApi,
  type CafePaymentMethod,
} from "../../lib/cafe";
import { formatRupees } from "../../lib/format";
import { ApiError } from "../../lib/api";
import {
  trackCafeCheckoutStarted,
  trackCafeOrderPlaced,
  trackCafePaymentMethodSelected,
} from "../../lib/analytics";
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
 * Whether a Razorpay rejection leaves any doubt that money moved.
 * Razorpay only mints `metadata.payment_id` once it has created a real
 * payment attempt, and only leaves the `payment_initiation` step once the
 * request has reached the bank. A rejection carrying neither never touched a
 * payment instrument — a dismiss at the method picker, invalid options, a TLS
 * failure — so the debit warning there just frightens customers whose card
 * was plainly declined.
 */
function mayHaveDebited(e: PaymentErrorData | undefined): boolean {
  if (e?.metadata?.payment_id) return true;
  const step = e?.step;
  return !!step && step !== "payment_initiation";
}

/**
 * Cafe checkout — mirrors the shop checkout shape. For RAZORPAY:
 * server returns a CafePaymentIntent id; we open the native modal,
 * verify on success → server materialises the real CafeOrder and
 * returns its id, which we navigate to. Modal dismiss / failure →
 * leave the intent in place: we can't tell an abandoned payment from
 * a captured one the SDK failed to report, and the intent reserves
 * nothing. For CASH / UPI_QR: order lands immediately, navigate
 * straight to detail.
 */
export function CafeCheckoutScreen() {
  const navigation = useNavigation<Nav>();
  const cart = useCafeCart();
  const { state } = useAuth();
  const signedInUser = state.status === "signedIn" ? state.user : null;

  const [method, setMethod] = useState<CafePaymentMethod>("RAZORPAY");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coupon, setCoupon] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<{
    code: string;
    discount: number;
  } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [note, setNote] = useState("");

  const checkoutTrackedRef = useRef(false);
  useEffect(() => {
    if (checkoutTrackedRef.current || cart.lines.length === 0) return;
    checkoutTrackedRef.current = true;
    trackCafeCheckoutStarted(cart.itemCount, cart.subtotal);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per visit
  }, []);

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

  const discount = appliedCoupon?.discount ?? 0;
  const total = Math.max(0, cart.subtotal - discount);

  async function handleApplyCoupon() {
    const code = coupon.trim();
    if (!code) return;
    setCouponLoading(true);
    setCouponError(null);
    try {
      const res = await cafeApi.validateCoupon(
        code,
        cart.lines.map((l) => ({
          cafeItemId: l.cafeItemId,
          quantity: l.quantity,
        })),
      );
      if (res.valid) {
        setAppliedCoupon({ code, discount: res.discount ?? 0 });
      } else {
        setAppliedCoupon(null);
        setCouponError(res.error ?? "Invalid coupon");
      }
    } catch (err) {
      setCouponError(
        err instanceof ApiError ? err.message : "Couldn't apply coupon",
      );
    } finally {
      setCouponLoading(false);
    }
  }

  function removeCoupon() {
    setAppliedCoupon(null);
    setCoupon("");
    setCouponError(null);
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
        discountCode: appliedCoupon?.code,
        note: note.trim() || undefined,
      });

      // In-person path — order is real, navigate straight to detail.
      if (!orderRes.intent) {
        trackCafeOrderPlaced(orderRes.orderId, total, method);
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
        // Deliberately does NOT cancel the intent. A rejection here
        // doesn't prove the money stayed put — Razorpay may have
        // auto-captured while the sheet hung on the bank page, and the
        // Back press that escapes it arrives as code 2 (the incident
        // documented in book/CheckoutScreen.tsx). Deleting the intent
        // would destroy the only record of the cart, and the Razorpay
        // webhook has no cafe branch to rebuild it from. A surviving
        // intent reserves nothing (stock is re-validated at
        // materialise time), so keeping it costs nothing and leaves a
        // captured payment reconcilable.
        //
        // The surviving intent is deliberately NOT stamped `claimedAt`:
        // that field feeds the admin unconfirmed queue, whose
        // verify/force actions both resolve through PhonePe and bail
        // with "No PhonePe transaction on this purchase" for a Razorpay
        // intent. Parking one there would show staff a row they cannot
        // action, so the copy promises a trace — which staff really can
        // do from the Razorpay dashboard — not a confirmed order.
        if (
          e?.code === 2 ||
          e?.description?.toLowerCase().includes("cancel")
        ) {
          setError(
            mayHaveDebited(e)
              ? "Payment cancelled. If your account was debited, do NOT pay again — contact the cafe counter and we'll trace the payment."
              : "Payment cancelled. Your order was not placed.",
          );
          return;
        }
        const reason = e?.description || "Payment failed";
        throw new Error(
          mayHaveDebited(e)
            ? `${reason} — if your account was debited, do NOT pay again; contact the cafe counter and we'll trace it.`
            : reason,
        );
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

      trackCafeOrderPlaced(verify.orderId, total, "RAZORPAY");
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
          {discount > 0 ? (
            <View style={styles.summaryRow}>
              <Text variant="small" color={colors.zinc400} style={{ flex: 1 }}>
                Coupon ({appliedCoupon?.code})
              </Text>
              <Text variant="small" color={colors.emerald400}>
                −{formatRupees(discount)}
              </Text>
            </View>
          ) : null}
          <View style={styles.divider} />
          <View style={styles.summaryRow}>
            <Text variant="bodyStrong">Total</Text>
            <Text variant="heading" weight="700" color={colors.emerald400}>
              {formatRupees(total)}
            </Text>
          </View>
        </Card>

        {/* Coupon */}
        <Card style={styles.sectionCard}>
          {appliedCoupon ? (
            <View style={styles.couponApplied}>
              <Text variant="small" weight="600" color={colors.emerald400}>
                {appliedCoupon.code} applied
              </Text>
              <Pressable onPress={removeCoupon} hitSlop={8}>
                <Text variant="small" color={colors.zinc400}>
                  Remove
                </Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.couponRow}>
              <View style={{ flex: 1 }}>
                <Input
                  placeholder="Coupon code"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  value={coupon}
                  onChangeText={(v) => {
                    setCoupon(v);
                    if (couponError) setCouponError(null);
                  }}
                />
              </View>
              <Button
                label="Apply"
                variant="secondary"
                onPress={handleApplyCoupon}
                loading={couponLoading}
                disabled={!coupon.trim()}
              />
            </View>
          )}
          {couponError ? (
            <Text
              variant="tiny"
              color={colors.destructive}
              style={{ marginTop: spacing["2"] }}
            >
              {couponError}
            </Text>
          ) : null}
        </Card>

        {/* Note */}
        <Card style={styles.sectionCard}>
          <Text
            variant="tiny"
            color={colors.zinc500}
            style={styles.sectionLabel}
          >
            NOTE (OPTIONAL)
          </Text>
          <Input
            placeholder="Any special instructions?"
            value={note}
            onChangeText={setNote}
            multiline
            maxLength={500}
          />
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
                onPress={() => {
                  setMethod(m.id);
                  trackCafePaymentMethodSelected(m.id);
                }}
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
              ? `Pay ${formatRupees(total)}`
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
  sectionCard: { padding: spacing["4"], gap: spacing["2"] },
  couponRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing["2"],
  },
  couponApplied: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
