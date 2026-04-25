import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  CircleCheck,
  MessageCircle,
  Smartphone,
  ShieldCheck,
} from "lucide-react-native";
import { Text } from "../ui/Text";
import { Card } from "../ui/Card";
import { colors, radius, spacing } from "../../theme";
import { env } from "../../config/env";
import { formatRupees } from "../../lib/format";
import { paymentsApi } from "../../lib/payments";
import type { UpiConfigResponse } from "../../lib/types";

export type UpiCommitResult = { bookingId?: string; error?: string } | void;

interface Props {
  amount: number;
  isAdvance?: boolean;
  advanceAmount?: number;
  onPaymentInitiated: () => Promise<UpiCommitResult> | UpiCommitResult;
  onCancel: () => void;
  /** Called once the user indicates they've shared the screenshot — the
   *  CheckoutScreen uses this to navigate to BookingDetail. */
  onDone: (bookingId: string) => void;
}

// Absolute image URLs so RN's Image loader can fetch them from the same
// backend that serves the web app's /public folder. Mirrors web's
// TURF_QR_OPTIONS (3 random terminals).
const TURF_QR_OPTIONS = [
  { image: `${env.apiUrl}/phonepe-qr-1.png`, label: "Terminal 1" },
  { image: `${env.apiUrl}/phonepe-qr-2.png`, label: "Terminal 2" },
  { image: `${env.apiUrl}/phonepe-qr-3.png`, label: "Terminal 3" },
];

const WHATSAPP_NUMBER = "916396177261";

type Step = "scan" | "paid";

/**
 * Mirrors `components/payment/upi-qr-checkout.tsx` on web.
 *
 *   Step 1 (scan): QR + amount + "I've Completed the Payment" button. Calling
 *     onPaymentInitiated is expected to create the Booking(PENDING) server-
 *     side and return its id — we stash that id for the WhatsApp deep-link.
 *   Step 2 (paid): "Slot Reserved" confirmation + WhatsApp-screenshot CTA +
 *     "View Booking Details" (which calls onDone with the bookingId).
 */
export function UpiQrCheckout({
  amount,
  isAdvance,
  advanceAmount,
  onPaymentInitiated,
  onCancel,
  onDone,
}: Props) {
  const [step, setStep] = useState<Step>("scan");
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [bookingId, setBookingId] = useState<string | null>(null);

  // Lock in one terminal QR per mount so the UI doesn't shuffle on re-render.
  const selectedQr = useMemo(
    () => TURF_QR_OPTIONS[Math.floor(Math.random() * TURF_QR_OPTIONS.length)],
    []
  );

  const displayAmount = isAdvance && advanceAmount ? advanceAmount : amount;

  // Fetch the merchant VPA so we can build a `upi://pay?…` deep link.
  // This is what lets the user pay with a UPI app installed on the
  // *same* device they're booking from — no second phone, no
  // save-to-gallery dance.
  //
  // The query is intentionally cheap and cacheable (the VPA almost
  // never changes), so we keep it stale for a long time. If the env
  // isn't configured server-side `vpa` comes back null and the button
  // simply doesn't render.
  const { data: upiConfig } = useQuery<UpiConfigResponse>({
    queryKey: ["upi-config"],
    queryFn: () => paymentsApi.upiConfig(),
    staleTime: 30 * 60 * 1000, // 30 min
    gcTime: 60 * 60 * 1000, // 1 h
  });

  /**
   * Build a UPI Spec deep link. The standard fields are:
   *   pa = payee VPA (required)
   *   pn = payee name (URL-encoded)
   *   am = amount in rupees (no paise — strings like "150.00" work too)
   *   cu = currency, always "INR"
   *   tn = transaction note (URL-encoded)
   *   tr = optional merchant txn ref
   */
  const upiDeepLink = useMemo(() => {
    if (!upiConfig?.vpa) return null;
    const params = new URLSearchParams({
      pa: upiConfig.vpa,
      pn: upiConfig.payeeName,
      am: displayAmount.toFixed(2),
      cu: "INR",
      tn: bookingId
        ? `Momentum Arena Booking #${bookingId.slice(-8)}`
        : "Momentum Arena Booking",
    });
    return `upi://pay?${params.toString()}`;
  }, [upiConfig, displayAmount, bookingId]);

  async function openUpiApp() {
    if (!upiDeepLink) return;
    try {
      await Linking.openURL(upiDeepLink);
    } catch {
      // Most commonly hit when no UPI app is installed (or on iOS
      // simulators). Let the user know politely and leave the QR as
      // the obvious fallback.
      Alert.alert(
        "No UPI app found",
        "Couldn't open a UPI app on this device. Please scan the QR with PhonePe, Google Pay, Paytm or any other UPI app.",
      );
    }
  }

  const whatsappUrl = useMemo(() => {
    const msg = bookingId
      ? `Hi, I've made a payment of ${formatRupees(displayAmount)} for Booking #${bookingId.slice(-8)}.\n\nPlease find the payment screenshot attached. Kindly confirm my booking.`
      : `Hi, I've made a payment of ${formatRupees(displayAmount)}.\n\nPlease find the payment screenshot attached. Kindly confirm my booking.`;
    return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`;
  }, [bookingId, displayAmount]);

  async function handleDone() {
    if (committing) return;
    setCommitting(true);
    setCommitError(null);
    try {
      const result = await onPaymentInitiated();
      if (result && "error" in result && result.error) {
        setCommitError(result.error);
        return;
      }
      if (result && "bookingId" in result && result.bookingId) {
        setBookingId(result.bookingId);
      }
      setStep("paid");
    } catch (e) {
      setCommitError(
        e instanceof Error ? e.message : "Something went wrong"
      );
    } finally {
      setCommitting(false);
    }
  }

  async function openWhatsapp() {
    const ok = await Linking.canOpenURL(whatsappUrl);
    if (ok) void Linking.openURL(whatsappUrl);
  }

  if (step === "paid") {
    return (
      <View style={styles.stack}>
        <View style={styles.reservedCard}>
          <CheckCircle2 size={56} color={colors.emerald400} />
          <Text variant="heading" weight="700" align="center">
            Your Slot is Reserved!
          </Text>
          <Text
            variant="small"
            align="center"
            color={colors.zinc400}
            style={styles.reservedSub}
          >
            Please allow us 30 minutes to verify your payment and confirm your
            booking.
          </Text>
        </View>

        <Card style={styles.screenshotCard}>
          <View style={styles.screenshotHeader}>
            <ShieldCheck size={20} color="#fbbf24" />
            <View style={styles.screenshotBody}>
              <Text variant="body" weight="600">
                Send Payment Screenshot
              </Text>
              <Text variant="small" color={colors.zinc400}>
                Please share a screenshot of your payment on WhatsApp so our
                team can verify and confirm your booking quickly.
              </Text>
            </View>
          </View>

          <Pressable
            onPress={openWhatsapp}
            style={({ pressed }) => [
              styles.whatsappBtn,
              pressed && { opacity: 0.9 },
            ]}
          >
            <MessageCircle size={20} color="#fff" />
            <Text variant="body" weight="600" color="#fff">
              Share Screenshot on WhatsApp
            </Text>
          </Pressable>

          <Pressable
            onPress={() => bookingId && onDone(bookingId)}
            disabled={!bookingId}
            style={({ pressed }) => [
              styles.viewBookingBtn,
              !bookingId && { opacity: 0.5 },
              pressed && bookingId ? { opacity: 0.85 } : null,
            ]}
          >
            <Text variant="body" weight="600" color={colors.foreground}>
              {bookingId ? "View Booking Details" : "My Bookings"}
            </Text>
          </Pressable>
        </Card>

        <Text variant="tiny" align="center" color={colors.zinc500}>
          You'll receive a confirmation message once verified.
        </Text>
      </View>
    );
  }

  // Step 1 — scan.
  return (
    <View style={styles.stack}>
      {/* Primary CTA for same-device payment: launches the user's
          installed UPI app (PhonePe / Google Pay / Paytm / BHIM …)
          via the standard `upi://pay?…` deep link. Hidden when the
          merchant VPA isn't configured server-side. */}
      {upiDeepLink ? (
        <Pressable
          onPress={openUpiApp}
          disabled={committing}
          style={({ pressed }) => [
            styles.upiAppBtn,
            pressed && !committing && { opacity: 0.9 },
          ]}
        >
          <Smartphone size={20} color="#fff" />
          <View style={styles.upiAppBtnText}>
            <Text variant="body" weight="700" color="#fff">
              Pay with UPI App
            </Text>
            <Text variant="tiny" color="rgba(255,255,255,0.85)">
              Opens PhonePe, GPay, Paytm, BHIM…
            </Text>
          </View>
        </Pressable>
      ) : null}

      {upiDeepLink ? (
        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text variant="tiny" color={colors.zinc500} style={styles.dividerText}>
            OR SCAN WITH ANOTHER DEVICE
          </Text>
          <View style={styles.dividerLine} />
        </View>
      ) : null}

      <View style={styles.qrCard}>
        <View style={styles.qrWrap}>
          <Image
            source={{ uri: selectedQr.image }}
            style={styles.qrImage}
            resizeMode="contain"
          />
        </View>
        <Text
          variant="heading"
          weight="700"
          color={colors.emerald400}
          style={styles.amount}
        >
          Pay {formatRupees(displayAmount)}
        </Text>
        {isAdvance && advanceAmount ? (
          <Text variant="tiny" color="#facc15" style={styles.amountSub}>
            Advance payment · Remaining at venue:{" "}
            {formatRupees(amount - advanceAmount)}
          </Text>
        ) : null}
        <Text variant="small" color={colors.zinc400} style={styles.amountSub}>
          Scan &amp; pay using any UPI app
        </Text>
        <Text variant="tiny" color={colors.zinc600}>
          Sportive Ventures · {selectedQr.label}
        </Text>
      </View>

      {commitError ? (
        <View style={styles.errorBox}>
          <Text variant="small" align="center" color={colors.destructive}>
            {commitError}
          </Text>
        </View>
      ) : null}

      <Pressable
        onPress={handleDone}
        disabled={committing}
        style={({ pressed }) => [
          styles.primaryBtn,
          pressed && !committing && { opacity: 0.9 },
          committing && { opacity: 0.7 },
        ]}
      >
        {committing ? (
          <>
            <ActivityIndicator color={colors.emerald400} />
            <Text variant="body" weight="600" color={colors.emerald400}>
              Reserving your slot…
            </Text>
          </>
        ) : (
          <>
            <CircleCheck size={20} color={colors.emerald400} />
            <Text variant="body" weight="600" color={colors.emerald400}>
              I've Completed the Payment
            </Text>
          </>
        )}
      </Pressable>

      <Text variant="tiny" align="center" color={colors.zinc600}>
        Click above after you've successfully paid via UPI
      </Text>

      <Pressable
        onPress={onCancel}
        disabled={committing}
        style={({ pressed }) => [
          styles.cancelBtn,
          pressed && !committing && { opacity: 0.7 },
        ]}
      >
        <Text variant="small" align="center" color={colors.zinc500}>
          ← Go back
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: spacing["5"],
  },
  // Same-device "Pay with UPI App" CTA. Solid emerald to mark it as the
  // primary path; the QR card below is the secondary fallback.
  upiAppBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing["3"],
    paddingVertical: 14,
    paddingHorizontal: spacing["4"],
    borderRadius: radius.lg,
    backgroundColor: "#059669", // emerald-600
  },
  upiAppBtnText: {
    alignItems: "flex-start",
    gap: 2,
  },
  // "OR SCAN WITH ANOTHER DEVICE" rule between the deep-link button and
  // the QR card — makes the two paths visually distinct.
  divider: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.zinc800,
  },
  dividerText: {
    letterSpacing: 1.2,
    fontWeight: "600",
  },
  qrCard: {
    alignItems: "center",
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["6"],
  },
  qrWrap: {
    padding: spacing["3"],
    backgroundColor: "#fff",
    borderRadius: radius.lg,
  },
  qrImage: {
    width: 240,
    height: 240,
    borderRadius: radius.md,
  },
  amount: {
    marginTop: spacing["5"],
    fontSize: 28,
    lineHeight: 32,
  },
  amountSub: {
    marginTop: spacing["1"],
  },
  errorBox: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.30)",
    backgroundColor: "rgba(239, 68, 68, 0.10)",
    padding: spacing["3"],
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing["2"],
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.emerald500_30,
    backgroundColor: colors.emerald500_10,
    paddingVertical: 14,
  },
  cancelBtn: {
    paddingVertical: spacing["2"],
  },
  reservedCard: {
    alignItems: "center",
    gap: spacing["3"],
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.emerald500_30,
    backgroundColor: colors.emerald500_05,
    padding: spacing["8"],
  },
  reservedSub: {
    maxWidth: 280,
  },
  screenshotCard: {
    gap: spacing["4"],
  },
  screenshotHeader: {
    flexDirection: "row",
    gap: spacing["3"],
  },
  screenshotBody: {
    flex: 1,
    gap: spacing["1"],
  },
  whatsappBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing["2"],
    backgroundColor: "#16a34a", // green-600
    paddingVertical: 14,
    borderRadius: radius.lg,
  },
  viewBookingBtn: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc700,
    backgroundColor: colors.zinc800,
  },
});
