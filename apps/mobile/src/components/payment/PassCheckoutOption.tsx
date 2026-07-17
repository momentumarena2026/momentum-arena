import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import RazorpayCheckout from "react-native-razorpay";
import type {
  PaymentErrorData,
  PaymentSuccessData,
} from "react-native-razorpay/src/types";
import { Ticket } from "lucide-react-native";
import { Text } from "../ui/Text";
import { colors, spacing } from "../../theme";
import { formatRupees } from "../../lib/format";
import { passesApi } from "../../lib/passes";
import type { PassOffer } from "../../lib/booking";
import { trackPassRedeemed } from "../../lib/analytics";

const hrs = (m: number) => `${(m / 60).toFixed(1).replace(/\.0$/, "")}h`;

/**
 * "Use my pass" banner on the booking checkout — mobile mirror of the
 * web PassCheckoutOption. Full coverage books instantly (₹0); partial
 * coverage debits the pass and collects the pro-rata remainder via the
 * native Razorpay SDK. Passes don't combine with coupons/points
 * (server-enforced — the redeem route drops both).
 */
export function PassCheckoutOption({
  holdId,
  offer,
  prefill,
  onBooked,
}: {
  holdId: string;
  offer: PassOffer;
  prefill: { name?: string | null; email?: string | null; phone?: string | null };
  onBooked: (bookingId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function redeem() {
    setBusy(true);
    setError(null);
    try {
      const data = await passesApi.redeem(holdId);
      if (data.bookingId) {
        trackPassRedeemed(offer.coveredMinutes, 0);
        onBooked(data.bookingId);
        return;
      }
      if (!data.topup) throw new Error(data.error || "Couldn't redeem the pass");

      // Top-up path — collect the remainder via the native SDK.
      let success: PaymentSuccessData;
      try {
        success = (await RazorpayCheckout.open({
          key: data.topup.keyId,
          amount: Math.round(data.topup.amount * 100), // paise
          currency: "INR",
          name: "Momentum Arena",
          description: "Pass top-up — balance difference",
          order_id: data.topup.orderId,
          prefill: {
            name: prefill.name ?? "",
            email: prefill.email ?? "",
            contact: prefill.phone ?? "",
          },
          theme: { color: colors.emerald500 },
        })) as PaymentSuccessData;
      } catch (err) {
        const e = err as PaymentErrorData;
        if (e?.code === 2 || e?.description?.toLowerCase().includes("cancel")) {
          return; // dismissed — nothing debited yet
        }
        throw new Error(e?.description || "Payment failed");
      }

      const vd = await passesApi.redeemVerify({
        holdId,
        razorpayOrderId: success.razorpay_order_id ?? "",
        razorpayPaymentId: success.razorpay_payment_id ?? "",
        razorpaySignature: success.razorpay_signature ?? "",
      });
      if (vd.bookingId) {
        trackPassRedeemed(offer.coveredMinutes, offer.remainderAmount);
        onBooked(vd.bookingId);
      } else {
        setError(vd.error || "Payment received — confirming your booking…");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Ticket size={16} color={colors.emerald400} />
        <Text style={styles.passName} numberOfLines={1}>
          {offer.passName}
        </Text>
        <Text style={styles.remaining}>{hrs(offer.remainingMinutes)} left</Text>
      </View>
      <Text style={styles.coverage}>
        {offer.fullCoverage
          ? `This booking (${hrs(offer.neededMinutes)}) is fully covered by your pass — nothing to pay.`
          : `Your pass covers ${hrs(offer.coveredMinutes)} of ${hrs(offer.neededMinutes)}; pay ${formatRupees(offer.remainderAmount)} for the rest.`}
      </Text>
      <Pressable
        onPress={() => void redeem()}
        disabled={busy}
        style={({ pressed }) => [
          styles.btn,
          (busy || pressed) && { opacity: 0.8 },
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.btnText}>
            {offer.fullCoverage
              ? "Book with my pass"
              : `Use pass + pay ${formatRupees(offer.remainderAmount)}`}
          </Text>
        )}
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Text style={styles.note}>
        Passes can&apos;t be combined with coupons or points.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.30)",
    backgroundColor: "rgba(16,185,129,0.05)",
    padding: spacing["4"],
    marginBottom: spacing["4"],
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  passName: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: colors.foreground,
  },
  remaining: {
    fontSize: 12,
    color: colors.zinc400,
  },
  coverage: {
    marginTop: 6,
    fontSize: 12,
    color: colors.zinc400,
    lineHeight: 17,
  },
  btn: {
    marginTop: spacing["3"],
    borderRadius: 12,
    backgroundColor: "#059669",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 11,
  },
  btnText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
  },
  error: {
    marginTop: spacing["2"],
    fontSize: 12,
    color: "#fbbf24",
  },
  note: {
    marginTop: spacing["2"],
    fontSize: 10,
    color: colors.zinc500,
  },
});
