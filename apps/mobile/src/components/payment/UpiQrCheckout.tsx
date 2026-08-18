import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type ImageSourcePropType,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AlertCircle,
  Check,
  CircleCheck,
  MessageCircle,
  Smartphone,
  X,
} from "lucide-react-native";
import { Text } from "../ui/Text";
import { radius, spacing } from "../../theme";
import { env } from "../../config/env";
import { formatRupees } from "../../lib/format";
import {
  trackUpiAppLaunched,
  trackUpiPaymentConfirmed,
  trackUpiQrShown,
  trackUpiClaimedPaid,
  trackUpiWhatsappClick,
} from "../../lib/analytics";

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
  /** Venue balance after the advance UPI payment (50% now flow). */
  remainingAmount?: number;
  /** Legacy inline-header slot — unused now that the checkout presents as a
   *  bottom sheet with its own header; kept so existing callers type-check. */
  header?: ReactNode;
}

// Dark zinc/emerald sheet palette — identical to DqrCheckout so both UPI
// flows (auto-confirming DQR + this manual static-QR fallback) read as one
// consistent Razorpay-style checkout sheet.
const SHEET_BG = "#18181b"; // zinc-900
const INK = "#fafafa"; // primary text
const INK_MUTED = "#a1a1aa"; // zinc-400 secondary text
const INK_FAINT = "#71717a"; // zinc-500 tertiary text
const HAIRLINE = "#27272a"; // zinc-800 dividers
const EMERALD = "#10b981";
const EMERALD_LIGHT = "#34d399"; // emerald-400 accents on dark
const RED = "#f87171"; // red-400 reads on dark
const AMBER_TEXT = "#fde68a"; // amber-200 notice body
const AMBER_STRIP_TEXT = "#fcd34d"; // amber-300 advance strip

const MOMENTUM_LOGO: ImageSourcePropType = require("../../assets/momentum-icon.png");

// Absolute image URLs so RN's Image loader can fetch them from the same
// backend that serves the web app's /public folder. Mirrors web's
// TURF_QR_OPTIONS (3 random terminals).
//
// Each terminal is paired with the VPA encoded inside its PhonePe QR PNG
// — that way the same-device deep link routes the payment to the same
// terminal account that would receive a scanned payment, and we don't
// need any server-side config for the button to work. (The VPAs are
// already public information: they're inside every QR we ship.)
const TURF_QR_OPTIONS = [
  { image: `${env.apiUrl}/phonepe-qr-1.png`, label: "Terminal 1", vpa: "Q611766519@ybl" },
  { image: `${env.apiUrl}/phonepe-qr-2.png`, label: "Terminal 2", vpa: "Q991517867@ybl" },
  { image: `${env.apiUrl}/phonepe-qr-3.png`, label: "Terminal 3", vpa: "Q510049074@ybl" },
];

// Payee name shown by the UPI app on the confirmation screen. Matches
// the merchant name decoded from the QR PNGs and the existing UI
// subtitle ("Sportive Ventures").
const PAYEE_NAME = "Sportive Ventures";

const WHATSAPP_NUMBER = "916396177261";

type Step = "scan" | "paid";

/**
 * Legacy static-QR UPI checkout, presented as a Razorpay-style bottom sheet
 * (same chrome as DqrCheckout so all UPI payments share one UI).
 *
 *   Step 1 (scan): printed-terminal QR on a white card + amount +
 *     "Pay with UPI App" deep link + "I've completed the payment" CTA.
 *     Calling onPaymentInitiated is expected to create the Booking(PENDING)
 *     server-side and return its id — we stash that id for the WhatsApp
 *     deep-link.
 *   Step 2 (paid): animated success check ("Booking received" — payment is
 *     verified manually) + WhatsApp-screenshot CTA + "View Booking Details"
 *     (which calls onDone with the bookingId).
 */
export function UpiQrCheckout({
  amount,
  isAdvance,
  advanceAmount,
  onPaymentInitiated,
  onCancel,
  onDone,
  remainingAmount,
}: Props) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>("scan");
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [bookingId, setBookingId] = useState<string | null>(null);

  const qrShownTrackedRef = useRef(false);
  // Static printed QR: no intent link, no app handoff, so mode is always
  // "qr" and there is never an app to attribute.
  const shownAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (qrShownTrackedRef.current) return;
    qrShownTrackedRef.current = true;
    shownAtRef.current = Date.now();
    trackUpiQrShown({
      surface: "booking",
      amount: isAdvance && advanceAmount ? advanceAmount : amount,
      mode: "qr",
    });
  }, [isAdvance, advanceAmount, amount]);

  // Success-animation drivers (built-in Animated — no extra deps). Same
  // spring-in circle + check pattern as DqrCheckout's confirmed phase.
  const circleScale = useRef(new Animated.Value(0)).current;
  const checkOpacity = useRef(new Animated.Value(0)).current;
  const checkScale = useRef(new Animated.Value(0.4)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;

  // Lock in one terminal QR per mount so the UI doesn't shuffle on re-render.
  const selectedQr = useMemo(
    () => TURF_QR_OPTIONS[Math.floor(Math.random() * TURF_QR_OPTIONS.length)],
    []
  );

  const displayAmount = isAdvance && advanceAmount ? advanceAmount : amount;

  /**
   * Build a UPI Spec deep link so the user can pay from a UPI app
   * installed on the *same* device they're booking from — no second
   * phone, no save-to-gallery dance.
   *
   * Uses the VPA paired with the displayed terminal QR (see
   * TURF_QR_OPTIONS) so the deep link routes to the same account a
   * scan would. The standard UPI fields are:
   *   pa = payee VPA (required)
   *   pn = payee name (URL-encoded)
   *   am = amount in rupees (no paise — strings like "150.00" work too)
   *   cu = currency, always "INR"
   *   tn = transaction note (URL-encoded)
   *   tr = optional merchant txn ref
   */
  const upiDeepLink = useMemo(() => {
    const params = new URLSearchParams({
      pa: selectedQr.vpa,
      pn: PAYEE_NAME,
      am: displayAmount.toFixed(2),
      cu: "INR",
      tn: bookingId
        ? `Momentum Arena Booking #${bookingId.slice(-8)}`
        : "Momentum Arena Booking",
    });
    return `upi://pay?${params.toString()}`;
  }, [selectedQr, displayAmount, bookingId]);

  async function openUpiApp() {
    if (!upiDeepLink) return;
    try {
      await Linking.openURL(upiDeepLink);
      trackUpiAppLaunched(displayAmount);
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
      // The customer asserting they paid — a weaker signal than a
      // gateway confirmation, and recorded separately so the two are not
      // read as the same thing.
      trackUpiClaimedPaid({
        surface: "booking",
        amount: displayAmount,
        app: null,
      });
      trackUpiPaymentConfirmed({
        surface: "booking",
        amount: displayAmount,
        app: null,
        mode: "qr",
        secondsWaited: shownAtRef.current
          ? Math.round((Date.now() - shownAtRef.current) / 1000)
          : 0,
      });
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
    trackUpiWhatsappClick(bookingId ?? undefined);
    const ok = await Linking.canOpenURL(whatsappUrl);
    if (ok) void Linking.openURL(whatsappUrl);
  }

  // X / backdrop / Android back. Ignore dismissal once the booking is
  // committed — the post-commit step owns navigation (mirror of DQR's
  // confirmed-phase guard) — and mid-commit, matching the old flow's
  // disabled cancel button.
  const dismiss = useCallback(() => {
    if (step === "paid" || committing) return;
    onCancel();
  }, [step, committing, onCancel]);

  // Razorpay-style success: emerald circle springs in with overshoot, the
  // check + copy follow ~200ms later. Depends ONLY on `step` — the parent
  // (CheckoutScreen) re-renders every second for the hold countdown, so
  // anything with inline-prop deps would restart each render (see the
  // matching note in DqrCheckout). No parent-callback timer here: the
  // handoff (onDone) is user-triggered by the "View Booking Details" button.
  useEffect(() => {
    if (step !== "paid") return;
    Animated.spring(circleScale, {
      toValue: 1,
      friction: 5,
      tension: 120,
      useNativeDriver: true,
    }).start();
    Animated.sequence([
      Animated.delay(200),
      Animated.parallel([
        Animated.timing(checkOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.spring(checkScale, { toValue: 1, friction: 6, useNativeDriver: true }),
        Animated.timing(textOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      ]),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- animated values are stable refs
  }, [step]);

  return (
    <Modal transparent animationType="slide" visible onRequestClose={dismiss}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={dismiss} />

        <View
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, spacing["4"]) },
          ]}
        >
          {/* ── Header ─────────────────────────────────────────────────── */}
          <View style={styles.sheetHeader}>
            <Image
              source={MOMENTUM_LOGO}
              style={styles.headerLogo}
              resizeMode="contain"
            />
            <View style={styles.headerLeft}>
              <Text style={styles.merchant}>Momentum Arena</Text>
              <Text style={styles.headerSub}>UPI payment</Text>
            </View>
            <Text style={styles.headerAmount}>{formatRupees(displayAmount)}</Text>
            <Pressable onPress={dismiss} hitSlop={8} style={styles.closeBtn}>
              <X size={20} color={INK_FAINT} />
            </Pressable>
          </View>
          <View style={styles.headerDivider} />
          {isAdvance && advanceAmount != null ? (
            <View style={styles.advanceStrip}>
              <Text variant="tiny" color={AMBER_STRIP_TEXT}>
                Advance {formatRupees(advanceAmount)} · Remaining at venue{" "}
                {formatRupees(
                  remainingAmount ?? Math.max(0, amount - advanceAmount),
                )}
              </Text>
            </View>
          ) : null}

          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.bodyContent}
          >
            {step === "scan" ? (
              <View style={styles.qrBlock}>
                {/* QR stays on a WHITE card — scanners need the light
                    quiet zone. */}
                <View style={styles.qrFrame}>
                  <Image
                    source={{ uri: selectedQr.image }}
                    style={styles.qrImage}
                    resizeMode="contain"
                  />
                </View>
                <Text style={styles.qrAmount}>Pay {formatRupees(displayAmount)}</Text>
                <Text variant="small" color={INK_MUTED}>
                  Scan &amp; pay using any UPI app
                </Text>
                <Text variant="tiny" color={INK_FAINT}>
                  Sportive Ventures · {selectedQr.label}
                </Text>

                {/* Heads-up about the merchant's UPI account restriction. Our
                    PhonePe Business account accepts only bank-linked UPI
                    (savings/current). Wallet balance, credit-card-on-UPI, and
                    overdraft accounts are rejected with a confusing "Payment
                    Failed" inside the UPI app. Surfacing this upfront saves the
                    customer from a failed attempt + frantic WhatsApp follow-up.
                    Mirror of the web upi-qr-checkout warning. */}
                <View style={styles.bankNotice}>
                  <AlertCircle size={14} color={AMBER_STRIP_TEXT} style={styles.noticeIcon} />
                  <Text variant="tiny" color={AMBER_TEXT} style={styles.noticeBody}>
                    <Text variant="tiny" weight="600" color={AMBER_TEXT}>
                      Pay from your bank-linked UPI
                    </Text>
                    {" "}(savings/current). Wallet balance, credit-card-on-UPI, and
                    overdraft accounts aren&apos;t accepted by this merchant and
                    will fail with a &quot;Payment Failed&quot; screen.
                  </Text>
                </View>

                {commitError ? (
                  <View style={styles.errorBox}>
                    <AlertCircle size={14} color={RED} style={styles.noticeIcon} />
                    <Text variant="tiny" color={RED} style={styles.noticeBody}>
                      {commitError}
                    </Text>
                  </View>
                ) : null}

                {/* Same-device deep link — opens the user's UPI app with the
                    amount + terminal VPA pre-filled. */}
                <Pressable
                  onPress={openUpiApp}
                  disabled={committing}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    pressed && !committing && styles.pressed,
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

                <Pressable
                  onPress={handleDone}
                  disabled={committing}
                  style={({ pressed }) => [
                    styles.outlineBtn,
                    pressed && !committing && styles.pressed,
                    committing && { opacity: 0.7 },
                  ]}
                >
                  {committing ? (
                    <>
                      <ActivityIndicator color={EMERALD_LIGHT} />
                      <Text variant="body" weight="600" color={EMERALD_LIGHT}>
                        Reserving your slot…
                      </Text>
                    </>
                  ) : (
                    <>
                      <CircleCheck size={20} color={EMERALD_LIGHT} />
                      <Text variant="body" weight="600" color={EMERALD_LIGHT}>
                        I've completed the payment
                      </Text>
                    </>
                  )}
                </Pressable>

                <Text variant="tiny" align="center" color={INK_FAINT}>
                  Tap above after you've paid via UPI. This payment is verified
                  manually — our team confirms your booking after checking it.
                </Text>
              </View>
            ) : null}

            {step === "paid" ? (
              <View style={styles.paidBlock}>
                <View style={styles.centerBlock}>
                  <Animated.View
                    style={[
                      styles.successCircle,
                      { transform: [{ scale: circleScale }] },
                    ]}
                  >
                    <Animated.View
                      style={{
                        opacity: checkOpacity,
                        transform: [{ scale: checkScale }],
                      }}
                    >
                      <Check size={36} color="#fff" strokeWidth={3} />
                    </Animated.View>
                  </Animated.View>
                  <Animated.View style={[styles.successCopy, { opacity: textOpacity }]}>
                    <Text variant="heading" color={INK} align="center">
                      Booking received
                    </Text>
                    <Text variant="small" color={INK_MUTED} align="center">
                      We'll verify your payment shortly
                    </Text>
                  </Animated.View>
                </View>

                <Text variant="small" color={INK_MUTED} align="center">
                  Please share a screenshot of your payment on WhatsApp so our
                  team can verify and confirm your booking quickly.
                </Text>

                <Pressable
                  onPress={openWhatsapp}
                  style={({ pressed }) => [
                    styles.whatsappBtn,
                    pressed && styles.pressed,
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
                  <Text variant="body" weight="600" color={INK}>
                    {bookingId ? "View Booking Details" : "My Bookings"}
                  </Text>
                </Pressable>

                <Text variant="tiny" align="center" color={INK_FAINT}>
                  You'll receive a confirmation message once verified.
                </Text>
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheet: {
    backgroundColor: SHEET_BG,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: HAIRLINE,
    maxHeight: "85%",
  },

  // ── Header ──────────────────────────────────────────────────────────────
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["4"],
    paddingBottom: spacing["3"],
  },
  headerLogo: { width: 32, height: 32, borderRadius: 8 },
  headerLeft: { flex: 1 },
  merchant: { fontSize: 15, fontWeight: "600", color: INK },
  headerSub: { fontSize: 12, color: INK_MUTED, marginTop: 1 },
  headerAmount: {
    fontSize: 15,
    fontWeight: "600",
    color: INK,
    textAlign: "right",
  },
  closeBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  headerDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: HAIRLINE,
  },
  advanceStrip: {
    backgroundColor: "rgba(245, 158, 11, 0.1)",
    paddingHorizontal: spacing["5"],
    paddingVertical: spacing["1.5"],
  },

  bodyContent: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["4"],
  },
  pressed: { opacity: 0.9 },

  // ── Scan step ───────────────────────────────────────────────────────────
  qrBlock: { alignItems: "center", gap: spacing["2"] },
  // QR stays on a WHITE card — scanners need the light quiet zone.
  qrFrame: {
    padding: spacing["3"],
    borderRadius: radius.lg,
    backgroundColor: "#fff",
  },
  qrImage: { width: 220, height: 220, borderRadius: radius.md },
  qrAmount: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: "700",
    color: EMERALD_LIGHT,
    marginTop: spacing["1"],
  },
  bankNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing["2"],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(245, 158, 11, 0.3)",
    backgroundColor: "rgba(245, 158, 11, 0.1)",
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2.5"],
    marginTop: spacing["2"],
  },
  noticeIcon: { marginTop: 1 },
  noticeBody: { flex: 1, lineHeight: 16 },
  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing["2"],
    alignSelf: "stretch",
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(248, 113, 113, 0.3)",
    backgroundColor: "rgba(248, 113, 113, 0.1)",
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2"],
    marginTop: spacing["2"],
  },

  // ── Buttons (same shapes as the DQR sheet) ──────────────────────────────
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing["2"],
    alignSelf: "stretch",
    paddingVertical: 14,
    borderRadius: radius.lg,
    backgroundColor: "#059669",
    marginTop: spacing["2"],
  },
  upiAppBtnText: {
    alignItems: "flex-start",
    gap: 2,
  },
  outlineBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing["2"],
    alignSelf: "stretch",
    paddingVertical: 14,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.4)",
    marginTop: spacing["2"],
  },

  // ── Paid step ───────────────────────────────────────────────────────────
  paidBlock: { gap: spacing["3"] },
  // Same success layout as DQR's centerBlock, with the bottom padding
  // trimmed because the WhatsApp + booking buttons follow inside the sheet.
  centerBlock: {
    alignItems: "center",
    gap: spacing["3"],
    paddingTop: spacing["6"],
    paddingBottom: spacing["2"],
  },
  successCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: EMERALD,
    alignItems: "center",
    justifyContent: "center",
  },
  successCopy: { alignItems: "center", gap: spacing["1"] },
  whatsappBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing["2"],
    alignSelf: "stretch",
    paddingVertical: 14,
    borderRadius: radius.lg,
    backgroundColor: "#16a34a", // green-600
  },
  viewBookingBtn: {
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
    paddingVertical: 14,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "#3f3f46", // zinc-700
    backgroundColor: HAIRLINE, // zinc-800
  },
});
