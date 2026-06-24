import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import {
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Smartphone,
} from "lucide-react-native";
import { Text } from "../ui/Text";
import { colors, radius, spacing } from "../../theme";
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
  header?: ReactNode;
}

type Phase = "init" | "scan" | "error";

const POLL_MS = 3000;

/**
 * Mobile dynamic-QR checkout — mirrors `components/payment/dqr-checkout.tsx`
 * on web. Generates a PhonePe DQR for the hold, renders the server-rendered
 * QR image (no native QR lib needed), and polls until PhonePe confirms — at
 * which point the booking is created server-side and onConfirmed fires.
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
  header,
}: Props) {
  const [phase, setPhase] = useState<Phase>("init");
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const qrStringRef = useRef<string | null>(null);
  const txnRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneRef = useRef(false);

  const displayAmount = isAdvance && advanceAmount ? advanceAmount : amount;

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
        onConfirmed(res.bookingId);
      } else if (res.state === "FAILED") {
        doneRef.current = true;
        stopPolling();
        setError("Payment failed or expired. Please try again.");
        setPhase("error");
      }
    } catch {
      // Transient — keep polling; the S2S callback is the backstop.
    }
  }, [onConfirmed, stopPolling]);

  const initiate = useCallback(async () => {
    doneRef.current = false;
    try {
      const res = await bookingApi.dqrInitiate({ holdId, isAdvance, overrideAmount });
      if (!res.qrImage || !res.transactionId) {
        setError(res.error || "Couldn't start UPI payment");
        setPhase("error");
        return;
      }
      qrStringRef.current = res.qrString;
      txnRef.current = res.transactionId;
      setQrImage(res.qrImage);
      setPhase("scan");
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
    if (phase !== "scan") return;
    pollRef.current = setInterval(checkStatus, POLL_MS);
    return stopPolling;
  }, [phase, checkStatus, stopPolling]);

  async function openUpiApp() {
    const link = qrStringRef.current;
    if (!link) return;
    try {
      await Linking.openURL(link);
    } catch {
      Alert.alert(
        "No UPI app found",
        "Couldn't open a UPI app. Please scan the QR with PhonePe, Google Pay, Paytm or any UPI app.",
      );
    }
  }

  if (phase === "error") {
    return (
      <View style={styles.centerStack}>
        <View style={styles.errorCard}>
          <AlertCircle size={40} color={colors.destructive} />
          <Text variant="small" align="center" color={colors.destructive}>
            {error}
          </Text>
        </View>
        <Pressable
          onPress={() => {
            setPhase("init");
            setError(null);
            void initiate();
          }}
          style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.9 }]}
        >
          <RefreshCw size={16} color="#fff" />
          <Text variant="body" weight="600" color="#fff">
            Try again
          </Text>
        </Pressable>
        <Pressable onPress={onCancel} style={styles.cancelBtn}>
          <Text variant="small" align="center" color={colors.zinc500}>
            ← Go back
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {header}

        <View style={styles.qrCard}>
          <View style={styles.qrWrap}>
            {qrImage ? (
              <Image
                source={{ uri: qrImage }}
                style={styles.qrImage}
                resizeMode="contain"
              />
            ) : (
              <View style={styles.qrLoading}>
                <ActivityIndicator color={colors.zinc400} />
              </View>
            )}
          </View>
          <Text
            variant="heading"
            weight="700"
            color={colors.emerald400}
            style={styles.amount}
          >
            Pay {formatRupees(displayAmount)}
          </Text>
          {isAdvance && advanceAmount != null ? (
            <Text variant="tiny" color="#facc15" style={styles.amountSub}>
              Advance: {formatRupees(advanceAmount)} • Remaining at venue:{" "}
              {formatRupees(remainingAmount ?? Math.max(0, amount - advanceAmount))}
            </Text>
          ) : null}
          <View style={styles.waitingRow}>
            <ActivityIndicator size="small" color={colors.zinc400} />
            <Text variant="small" color={colors.zinc400}>
              Waiting for payment…
            </Text>
          </View>
          <Text variant="tiny" color={colors.zinc600} style={styles.amountSub}>
            Confirms automatically once you pay — no screenshot needed.
          </Text>
        </View>

        <View style={styles.notice}>
          <AlertCircle size={14} color="#fbbf24" style={styles.noticeIcon} />
          <Text variant="tiny" color="#fde68a" style={styles.noticeText}>
            <Text variant="tiny" weight="600" color="#fcd34d">
              Pay from your bank-linked UPI
            </Text>
            {" "}(savings/current). Wallet balance, credit-card-on-UPI, and
            overdraft accounts aren&apos;t accepted and will fail.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.actionFooter}>
        <Pressable
          onPress={openUpiApp}
          style={({ pressed }) => [styles.upiAppBtn, pressed && { opacity: 0.9 }]}
        >
          <Smartphone size={20} color="#fff" />
          <Text variant="body" weight="700" color="#fff">
            Pay with UPI App
          </Text>
        </Pressable>
        <Pressable onPress={onCancel} style={styles.cancelBtn}>
          <Text variant="small" align="center" color={colors.zinc500}>
            ← Go back
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing["6"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["6"],
    gap: spacing["5"],
  },
  centerStack: {
    flex: 1,
    justifyContent: "center",
    gap: spacing["4"],
    paddingHorizontal: spacing["6"],
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
  qrImage: { width: 240, height: 240, borderRadius: radius.md },
  qrLoading: {
    width: 240,
    height: 240,
    alignItems: "center",
    justifyContent: "center",
  },
  amount: { marginTop: spacing["5"], fontSize: 28, lineHeight: 32 },
  amountSub: { marginTop: spacing["1"] },
  waitingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    marginTop: spacing["2"],
  },
  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing["2"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.30)",
    backgroundColor: "rgba(245, 158, 11, 0.05)",
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["3"],
  },
  noticeIcon: { marginTop: 1 },
  noticeText: { flex: 1, lineHeight: 16 },
  errorCard: {
    alignItems: "center",
    gap: spacing["3"],
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.30)",
    backgroundColor: "rgba(239, 68, 68, 0.05)",
    padding: spacing["6"],
  },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing["2"],
    paddingVertical: 14,
    borderRadius: radius.lg,
    backgroundColor: "#059669",
  },
  actionFooter: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing["6"],
    paddingTop: spacing["2.5"],
    paddingBottom: spacing["5"],
    backgroundColor: colors.background,
    gap: spacing["3"],
  },
  upiAppBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing["3"],
    paddingVertical: 14,
    paddingHorizontal: spacing["4"],
    borderRadius: radius.lg,
    backgroundColor: "#059669",
  },
  cancelBtn: { paddingVertical: spacing["2"] },
});
