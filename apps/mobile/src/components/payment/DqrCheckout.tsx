import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AlertCircle,
  Check,
  ChevronRight,
  QrCode,
  RefreshCw,
  X,
} from "lucide-react-native";
import { Text } from "../ui/Text";
import { radius, spacing } from "../../theme";
import { formatRupees } from "../../lib/format";
import { bookingApi } from "../../lib/booking";

interface Props {
  holdId: string;
  amount: number;
  /** Full net payable (post coupon + points); sent as overrideAmount so the
   *  route charges the discounted total, not the gross hold amount. */
  overrideAmount?: number;
  isAdvance?: boolean;
  advanceAmount?: number;
  remainingAmount?: number;
  /** Called with the bookingId once PhonePe confirms the payment. */
  onConfirmed: (bookingId: string) => void;
  onCancel: () => void;
  /** Legacy inline-header slot — unused now that the checkout presents as a
   *  bottom sheet with its own header; kept so existing callers type-check. */
  header?: ReactNode;
}

type Phase = "init" | "apps" | "qr" | "waiting" | "confirmed" | "error";

const POLL_MS = 3000;

// Razorpay-style LIGHT sheet palette — deliberate contrast with the app's
// dark theme so the checkout reads as a familiar payment surface.
const INK = "#18181b";
const INK_MUTED = "#71717a";
const INK_FAINT = "#a1a1aa";
const HAIRLINE = "#e4e4e7";
const TILE_BG = "#f4f4f5";
const EMERALD = "#10b981";
const RED = "#dc2626";

/**
 * UPI intent deep-link prefixes for the big four apps. The query string is
 * shared: everything after the `?` of the server's `upi://pay?...` qrString
 * (payee VPA, amount, txn ref) is app-agnostic — only the scheme differs.
 */
const UPI_APPS: {
  key: string;
  name: string;
  prefix: string;
  tileBg: string;
  tileBordered?: boolean;
  glyph: string;
  glyphColor: string;
}[] = [
  { key: "phonepe", name: "PhonePe", prefix: "phonepe://pay", tileBg: "#5F259F", glyph: "पे", glyphColor: "#fff" },
  { key: "gpay", name: "Google Pay", prefix: "tez://upi/pay", tileBg: "#fff", tileBordered: true, glyph: "G", glyphColor: "#4285F4" },
  { key: "paytm", name: "Paytm", prefix: "paytmmp://pay", tileBg: "#00BAF2", glyph: "P", glyphColor: "#fff" },
  { key: "bhim", name: "BHIM", prefix: "upi://pay", tileBg: "#ED752E", glyph: "B", glyphColor: "#fff" },
];

/**
 * Mobile PhonePe DQR checkout, presented as a Razorpay-style bottom sheet.
 *
 * Pay → sheet slides up over the dimmed screen → pick a UPI app (when the
 * server returns `mode: "intent"`) → the app opens with the amount pre-filled
 * → we poll until PhonePe confirms → success animation → onConfirmed(bookingId).
 * When the server returns `mode: "qr"` (Open-Intent product unavailable) the
 * sheet falls back to today's scan-the-QR flow, restyled onto the sheet.
 */
export function DqrCheckout({
  holdId,
  amount,
  overrideAmount,
  isAdvance,
  advanceAmount,
  remainingAmount,
  onConfirmed,
  onCancel,
}: Props) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>("init");
  const [mode, setMode] = useState<"intent" | "qr" | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrString, setQrString] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appOpenError, setAppOpenError] = useState<string | null>(null);
  const [waitingApp, setWaitingApp] = useState<{ name: string; url: string } | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const txnRef = useRef<string | null>(null);
  const bookingIdRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneRef = useRef(false);

  // Success-animation drivers (built-in Animated — no extra deps).
  const circleScale = useRef(new Animated.Value(0)).current;
  const checkOpacity = useRef(new Animated.Value(0)).current;
  const checkScale = useRef(new Animated.Value(0.4)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;

  const displayAmount = isAdvance && advanceAmount ? advanceAmount : amount;
  // Payment can land while the sheet shows the app list, the QR, or the
  // post-app-hop waiting state — poll + count down across all three.
  const awaitingPayment = phase === "apps" || phase === "qr" || phase === "waiting";

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const checkStatus = useCallback(async () => {
    const txn = txnRef.current;
    if (!txn || doneRef.current) return;
    try {
      const res = await bookingApi.dqrStatus(txn);
      if (res.state === "COMPLETED" && res.bookingId) {
        doneRef.current = true;
        stopPolling();
        bookingIdRef.current = res.bookingId;
        setPhase("confirmed");
      } else if (res.state === "FAILED") {
        doneRef.current = true;
        stopPolling();
        setError("Payment failed or expired. Please try again.");
        setPhase("error");
      }
    } catch {
      // Transient — keep polling; the S2S callback is the backstop.
    }
  }, [stopPolling]);

  const initiate = useCallback(async () => {
    doneRef.current = false;
    try {
      const res = await bookingApi.dqrInitiate({ holdId, isAdvance, overrideAmount });
      // "intent" needs a tappable upi:// string; "qr" needs the rendered image.
      const canIntent = res.mode === "intent" && !!res.qrString;
      if (!res.transactionId || (!canIntent && !res.qrImage)) {
        setError(res.error || "Couldn't start UPI payment");
        setPhase("error");
        return;
      }
      txnRef.current = res.transactionId;
      setQrImage(res.qrImage ?? null);
      setQrString(res.qrString ?? null);
      setSecondsLeft(res.expiresIn);
      setMode(canIntent ? "intent" : "qr");
      setPhase(canIntent ? "apps" : "qr");
    } catch {
      setError("Couldn't start UPI payment");
      setPhase("error");
    }
  }, [holdId, isAdvance, overrideAmount]);

  useEffect(() => {
    void initiate();
    return stopPolling;
  }, [initiate, stopPolling]);

  useEffect(() => {
    if (!awaitingPayment) return;
    pollRef.current = setInterval(checkStatus, POLL_MS);
    return stopPolling;
  }, [awaitingPayment, checkStatus, stopPolling]);

  // TTL countdown. PhonePe rejects an expired transaction, so when the TTL
  // runs out we stop polling and surface a regenerate prompt (the error
  // retry re-initiates with a fresh QR/intent + timer).
  useEffect(() => {
    if (!awaitingPayment || secondsLeft == null) return;
    if (secondsLeft <= 0) {
      doneRef.current = true;
      stopPolling();
      setError("This payment request expired. Start again to continue.");
      setPhase("error");
      return;
    }
    const id = setTimeout(
      () => setSecondsLeft((s) => (s == null ? s : s - 1)),
      1000,
    );
    return () => clearTimeout(id);
  }, [awaitingPayment, secondsLeft, stopPolling]);

  // Razorpay-style success: emerald circle springs in with overshoot, the
  // check + copy follow ~200ms later, hold ~1.4s, then hand off to the parent.
  useEffect(() => {
    if (phase !== "confirmed") return;
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
    const id = setTimeout(() => {
      if (bookingIdRef.current) onConfirmed(bookingIdRef.current);
    }, 1400);
    return () => clearTimeout(id);
  }, [phase, circleScale, checkOpacity, checkScale, textOpacity, onConfirmed]);

  // Intentionally NOT Linking.canOpenURL: on iOS that requires each scheme in
  // LSApplicationQueriesSchemes (a native build), while plain openURL + catch
  // stays OTA-safe. Rejection = app not installed → inline note, stay on list.
  const openUpiApp = useCallback((name: string, url: string) => {
    setAppOpenError(null);
    Linking.openURL(url)
      .then(() => {
        setWaitingApp({ name, url });
        setPhase("waiting");
      })
      .catch(() => {
        setAppOpenError(
          "Couldn't open the app — is it installed? Try another option.",
        );
      });
  }, []);

  const dismiss = useCallback(() => {
    // Ignore dismissal once paid — the success handoff owns navigation.
    if (phase === "confirmed") return;
    onCancel();
  }, [phase, onCancel]);

  const q = qrString ? qrString.split("?")[1] ?? "" : "";
  const countdown =
    secondsLeft != null
      ? `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`
      : null;

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
            <View style={styles.headerLeft}>
              <Text style={styles.merchant}>Momentum Arena</Text>
              <Text style={styles.headerSub}>UPI payment</Text>
            </View>
            <Text style={styles.headerAmount}>{formatRupees(displayAmount)}</Text>
            <Pressable onPress={dismiss} hitSlop={8} style={styles.closeBtn}>
              <X size={20} color={INK_MUTED} />
            </Pressable>
          </View>
          <View style={styles.headerDivider} />
          {isAdvance && advanceAmount != null ? (
            <View style={styles.advanceStrip}>
              <Text variant="tiny" color="#92400e">
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
            {phase === "init" ? (
              <View style={styles.centerBlock}>
                <ActivityIndicator size="large" color={EMERALD} />
                <Text variant="small" color={INK_MUTED}>
                  Setting up UPI payment…
                </Text>
              </View>
            ) : null}

            {phase === "apps" ? (
              <View>
                <Text variant="tiny" weight="600" color={INK_MUTED} style={styles.listLabel}>
                  Pay using UPI app
                </Text>
                {appOpenError ? (
                  <View style={styles.openErrorBox}>
                    <AlertCircle size={14} color={RED} style={styles.noticeIcon} />
                    <Text variant="tiny" color={RED} style={styles.noticeBody}>
                      {appOpenError}
                    </Text>
                  </View>
                ) : null}
                {UPI_APPS.map((app, i) => (
                  <View key={app.key}>
                    {i > 0 ? <View style={styles.rowDivider} /> : null}
                    <AppRow
                      name={app.name}
                      onPress={() => openUpiApp(app.name, `${app.prefix}?${q}`)}
                      tile={
                        <Tile bg={app.tileBg} bordered={app.tileBordered}>
                          <Text style={[styles.tileGlyph, { color: app.glyphColor }]}>
                            {app.glyph}
                          </Text>
                        </Tile>
                      }
                    />
                  </View>
                ))}
                <View style={styles.rowDivider} />
                <AppRow
                  name="Scan QR code"
                  onPress={() => setPhase("qr")}
                  tile={
                    <Tile bg={TILE_BG}>
                      <QrCode size={18} color={INK} />
                    </Tile>
                  }
                />
                <View style={styles.rowDivider} />
                <AppRow
                  name="Other UPI apps"
                  onPress={() => openUpiApp("your UPI app", `upi://pay?${q}`)}
                  tile={
                    <Tile bg={TILE_BG}>
                      <Text style={[styles.tileGlyph, { color: INK }]}>₹</Text>
                    </Tile>
                  }
                />
              </View>
            ) : null}

            {phase === "qr" ? (
              <View style={styles.qrBlock}>
                {mode === "intent" ? (
                  <Pressable onPress={() => setPhase("apps")} style={styles.backLink}>
                    <Text variant="small" color={INK_MUTED}>
                      ← Choose UPI app instead
                    </Text>
                  </Pressable>
                ) : null}
                <View style={styles.qrFrame}>
                  {qrImage ? (
                    <Image
                      source={{ uri: qrImage }}
                      style={styles.qrImage}
                      resizeMode="contain"
                    />
                  ) : (
                    <View style={styles.qrLoading}>
                      <ActivityIndicator color={INK_FAINT} />
                    </View>
                  )}
                </View>
                <Text style={styles.qrAmount}>Pay {formatRupees(displayAmount)}</Text>
                <View style={styles.waitingRow}>
                  <ActivityIndicator size="small" color={INK_FAINT} />
                  <Text variant="small" color={INK_MUTED}>
                    Waiting for payment…
                  </Text>
                </View>
                {countdown ? (
                  <Text variant="tiny" color={INK_FAINT}>
                    Expires in {countdown}
                  </Text>
                ) : null}
                <Text variant="tiny" color={INK_FAINT} align="center">
                  Scan with any UPI app — confirms automatically once you pay.
                </Text>
                <View style={styles.bankNotice}>
                  <AlertCircle size={14} color="#b45309" style={styles.noticeIcon} />
                  <Text variant="tiny" color="#92400e" style={styles.noticeBody}>
                    <Text variant="tiny" weight="600" color="#92400e">
                      Pay from your bank-linked UPI
                    </Text>{" "}
                    (savings/current). Wallet balance, credit-card-on-UPI, and
                    overdraft accounts aren&apos;t accepted and will fail.
                  </Text>
                </View>
              </View>
            ) : null}

            {phase === "waiting" ? (
              <View style={styles.centerBlock}>
                <ActivityIndicator size="large" color={EMERALD} />
                <Text variant="bodyStrong" color={INK} align="center">
                  Complete payment in {waitingApp?.name ?? "your UPI app"}
                </Text>
                <Text variant="small" color={INK_MUTED} align="center">
                  Confirms automatically the moment you pay.
                </Text>
                {countdown ? (
                  <Text variant="tiny" color={INK_FAINT}>
                    Expires in {countdown}
                  </Text>
                ) : null}
                <Pressable
                  onPress={() => {
                    if (!waitingApp) return;
                    Linking.openURL(waitingApp.url).catch(() => {
                      Alert.alert(
                        "Couldn't open the app",
                        "Is it installed? Try another option.",
                      );
                    });
                  }}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text variant="body" weight="600" color="#fff">
                    Open {waitingApp?.name ?? "your UPI app"} again
                  </Text>
                </Pressable>
                <Pressable onPress={() => setPhase("apps")} style={styles.ghostBtn}>
                  <Text variant="small" color={INK_MUTED}>
                    Choose another app
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {phase === "confirmed" ? (
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
                    Payment successful
                  </Text>
                  <Text variant="small" color={INK_MUTED} align="center">
                    Your booking is confirmed
                  </Text>
                </Animated.View>
              </View>
            ) : null}

            {phase === "error" ? (
              <View style={styles.centerBlock}>
                <View style={styles.errorCard}>
                  <AlertCircle size={40} color={RED} />
                  <Text variant="small" align="center" color={RED}>
                    {error}
                  </Text>
                </View>
                <Pressable
                  onPress={() => {
                    setPhase("init");
                    setError(null);
                    setAppOpenError(null);
                    void initiate();
                  }}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    pressed && styles.pressed,
                  ]}
                >
                  <RefreshCw size={16} color="#fff" />
                  <Text variant="body" weight="600" color="#fff">
                    Try again
                  </Text>
                </Pressable>
                <Pressable onPress={onCancel} style={styles.ghostBtn}>
                  <Text variant="small" align="center" color={INK_MUTED}>
                    Cancel
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ── Sheet building blocks ─────────────────────────────────────────────────────

/** 36px rounded app-icon tile — pure View+Text/icon, no image assets. */
function Tile({
  bg,
  bordered,
  children,
}: {
  bg: string;
  bordered?: boolean;
  children: ReactNode;
}) {
  return (
    <View
      style={[
        styles.tile,
        { backgroundColor: bg },
        bordered && styles.tileBordered,
      ]}
    >
      {children}
    </View>
  );
}

/** One tappable row in the UPI-app list: [tile] [name] [chevron]. */
function AppRow({
  name,
  onPress,
  tile,
}: {
  name: string;
  onPress: () => void;
  tile: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.appRow, pressed && styles.appRowPressed]}
    >
      {tile}
      <Text style={styles.appName}>{name}</Text>
      <ChevronRight size={18} color={INK_FAINT} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
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
    backgroundColor: "#fef3c7",
    paddingHorizontal: spacing["5"],
    paddingVertical: spacing["1.5"],
  },

  bodyContent: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["4"],
  },
  centerBlock: {
    alignItems: "center",
    gap: spacing["3"],
    paddingVertical: spacing["8"],
  },
  pressed: { opacity: 0.9 },

  // ── UPI app list ────────────────────────────────────────────────────────
  listLabel: { marginBottom: spacing["1"] },
  appRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    minHeight: 52,
    paddingVertical: spacing["2"],
  },
  appRowPressed: { backgroundColor: "#fafafa" },
  appName: { flex: 1, fontSize: 15, color: INK },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: HAIRLINE,
    marginLeft: 36 + spacing["3"],
  },
  tile: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  tileBordered: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#d4d4d8",
  },
  tileGlyph: { fontSize: 14, fontWeight: "700" },
  openErrorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing["2"],
    borderRadius: radius.md,
    backgroundColor: "rgba(220, 38, 38, 0.06)",
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2"],
    marginBottom: spacing["2"],
  },

  // ── QR phase ────────────────────────────────────────────────────────────
  qrBlock: { alignItems: "center", gap: spacing["2"] },
  backLink: { alignSelf: "flex-start", paddingVertical: spacing["1"] },
  qrFrame: {
    padding: spacing["2.5"],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HAIRLINE,
    backgroundColor: "#fff",
  },
  qrImage: { width: 220, height: 220, borderRadius: radius.md },
  qrLoading: {
    width: 220,
    height: 220,
    alignItems: "center",
    justifyContent: "center",
  },
  qrAmount: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: "700",
    color: INK,
    marginTop: spacing["1"],
  },
  waitingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  bankNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing["2"],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#fcd34d",
    backgroundColor: "#fffbeb",
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2.5"],
    marginTop: spacing["2"],
  },
  noticeIcon: { marginTop: 1 },
  noticeBody: { flex: 1, lineHeight: 16 },

  // ── Waiting / error / success ───────────────────────────────────────────
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
  ghostBtn: { paddingVertical: spacing["2"] },
  errorCard: {
    alignItems: "center",
    alignSelf: "stretch",
    gap: spacing["3"],
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: "rgba(220, 38, 38, 0.30)",
    backgroundColor: "rgba(220, 38, 38, 0.05)",
    padding: spacing["6"],
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
});
