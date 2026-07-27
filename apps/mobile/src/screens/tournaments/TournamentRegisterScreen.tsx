import { useEffect, useMemo, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import RazorpayCheckout from "react-native-razorpay";
import { ActivityIndicator } from "react-native";
import { Plus, Trash2, PartyPopper } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { colors, radius } from "../../theme";
import {
  getTournament,
  registerTeam,
  verifyEntryPayment,
  fetchTournamentHub,
  fetchRewardsPreview,
  initiateTournamentDqr,
  pollTournamentDqr,
} from "../../lib/tournaments";
import {
  trackTournamentRegisterStarted,
  trackTournamentRegisterCompleted,
} from "../../lib/analytics";
import { useAuth } from "../../providers/AuthProvider";
import type { AccountStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<AccountStackParamList>;
type Rt = RouteProp<AccountStackParamList, "TournamentRegister">;

const COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#10b981", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899", "#71717a"];

/** ₹ payable online for a fee config (mirrors lib/tournament-config). */
function onlinePayable(fee: number, mode: string, pct: number): number {
  if (mode === "FREE" || fee <= 0) return 0;
  if (mode === "ADVANCE") return Math.max(1, Math.round((fee * pct) / 100));
  return fee;
}

export function TournamentRegisterScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const { slug } = route.params;
  const { state: authState } = useAuth();
  const user = authState.user;
  const queryClient = useQueryClient();

  const { data } = useQuery({ queryKey: ["tournament", slug], queryFn: () => getTournament(slug) });
  const { data: hub } = useQuery({ queryKey: ["tournaments"], queryFn: fetchTournamentHub, staleTime: 300000 });
  const dqrAvailable = !!hub?.dqrAvailable;

  const [teamName, setTeamName] = useState("");
  const [color, setColor] = useState(COLORS[4]);
  const [members, setMembers] = useState<string[]>(["", ""]);
  const [captainName, setCaptainName] = useState(user?.name || "");
  const [captainPhone, setCaptainPhone] = useState(user?.phone || "");
  const [coupon, setCoupon] = useState("");
  const [method, setMethod] = useState<"upi" | "razorpay">("razorpay");
  const [usePoints, setUsePoints] = useState(false);
  const [pointsPreview, setPointsPreview] = useState<{ maxPoints: number; maxPaise: number } | null>(null);
  const [dqr, setDqr] = useState<null | { qrImage?: string; qrString?: string; transactionId: string; amount: number }>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { state: string; dueAtVenue: number }>(null);

  const t = data?.tournament;

  useEffect(() => {
    if (dqrAvailable) setMethod("upi");
  }, [dqrAvailable]);

  // Points preview against the entry fee (the server re-caps after coupon).
  useEffect(() => {
    let alive = true;
    if (!t || !t.allowRewardPoints || t.feeMode === "FREE" || t.entryFee <= 0) {
      setPointsPreview(null);
      return;
    }
    fetchRewardsPreview(t.entryFee)
      .then((d) => {
        if (alive) setPointsPreview({ maxPoints: d.maxPoints || 0, maxPaise: d.maxPaise || 0 });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t?.entryFee, t?.allowRewardPoints, t?.feeMode]);

  // DQR poll while the QR sheet is up.
  useEffect(() => {
    if (!dqr) return;
    const iv = setInterval(async () => {
      try {
        const d = await pollTournamentDqr(dqr.transactionId);
        if (d.state === "COMPLETED") {
          clearInterval(iv);
          setDqr(null);
          setBusy(false);
          setDone({ state: "CONFIRMED", dueAtVenue: 0 });
          trackTournamentRegisterCompleted(slug, "CONFIRMED", "upi");
          queryClient.invalidateQueries({ queryKey: ["tournament", slug] });
        } else if (d.state === "FAILED") {
          clearInterval(iv);
          setDqr(null);
          setBusy(false);
          setError(d.error || "Payment failed — please try again");
        }
      } catch {
        /* transient */
      }
    }, 3500);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dqr?.transactionId]);

  const filled = useMemo(() => members.map((m) => m.trim()).filter(Boolean), [members]);
  const pointsToRedeem = usePoints && pointsPreview ? pointsPreview.maxPoints : 0;
  const canSubmit =
    !!t &&
    teamName.trim().length >= 2 &&
    filled.length > 0 &&
    captainName.trim().length > 0 &&
    captainPhone.replace(/\D/g, "").length >= 10;

  const payablePreview = t
    ? onlinePayable(
        Math.max(
          0,
          t.entryFee - (usePoints && pointsPreview ? Math.round(pointsPreview.maxPaise / 100) : 0)
        ),
        t.feeMode,
        t.advancePct
      )
    : 0;

  const submit = async () => {
    if (!t || !canSubmit || busy) return;
    setBusy(true);
    setError(null);
    trackTournamentRegisterStarted(slug, t.entryFee);
    try {
      const res = await registerTeam({
        tournamentId: t.id,
        teamName,
        color,
        members: filled,
        captainName,
        captainPhone,
        couponCode: coupon.trim() || null,
        pointsToRedeem: pointsToRedeem || null,
      });
      if (res.error) {
        setError(res.error);
        setBusy(false);
        return;
      }
      if (res.state !== "PENDING_PAYMENT") {
        setDone({ state: res.state || "CONFIRMED", dueAtVenue: res.dueAtVenue || 0 });
        trackTournamentRegisterCompleted(slug, res.state || "CONFIRMED", "none");
        queryClient.invalidateQueries({ queryKey: ["tournament", slug] });
        setBusy(false);
        return;
      }

      // UPI (PhonePe DQR): show the QR; the poll effect completes the flow.
      if (method === "upi") {
        const dq = await initiateTournamentDqr(res.teamId!);
        setDqr({ qrImage: dq.qrImage, qrString: dq.qrString, transactionId: dq.transactionId, amount: dq.amount });
        return;
      }

      // Razorpay native checkout.
      const order = res.order!;
      const payment = await RazorpayCheckout.open({
        key: res.keyId || "",
        amount: Math.round(order.amount * 100),
        currency: "INR",
        name: "Momentum Arena",
        description: `${t.name} — entry fee`,
        order_id: order.orderId,
        theme: { color: "#10b981" },
        prefill: { name: captainName, contact: captainPhone },
      });
      const v = await verifyEntryPayment({
        razorpayOrderId: String(payment.razorpay_order_id || order.orderId),
        razorpayPaymentId: String(payment.razorpay_payment_id),
        razorpaySignature: String(payment.razorpay_signature),
      });
      if (v.error) {
        setError(v.error);
        setBusy(false);
        return;
      }
      setDone({ state: "CONFIRMED", dueAtVenue: res.dueAtVenue || 0 });
      trackTournamentRegisterCompleted(slug, "CONFIRMED", "razorpay");
      queryClient.invalidateQueries({ queryKey: ["tournament", slug] });
      setBusy(false);
    } catch (e) {
      const msg =
        e && typeof e === "object" && "description" in e
          ? String((e as { description?: string }).description || "Payment cancelled")
          : e instanceof Error
            ? e.message
            : "Something went wrong";
      setError(msg);
      setBusy(false);
    }
  };

  // ── UPI QR sheet ──
  if (dqr) {
    return (
      <Screen>
        <View style={styles.doneWrap}>
          <Text style={styles.doneTitle}>Scan to pay ₹{dqr.amount.toLocaleString("en-IN")}</Text>
          <Text style={styles.doneBody}>Use any UPI app — this screen confirms automatically.</Text>
          {dqr.qrImage ? (
            <Image source={{ uri: dqr.qrImage }} style={styles.qr} />
          ) : (
            <Text style={[styles.doneBody, { fontSize: 11 }]}>{dqr.qrString}</Text>
          )}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <ActivityIndicator size="small" color={colors.emerald400} />
            <Text style={{ color: colors.zinc400, fontSize: 13 }}>Waiting for payment…</Text>
          </View>
          <Pressable
            onPress={() => {
              setDqr(null);
              setBusy(false);
            }}
          >
            <Text style={{ color: colors.zinc400, fontSize: 13, textDecorationLine: "underline" }}>
              Cancel and choose another method
            </Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  if (done) {
    return (
      <Screen>
        <View style={styles.doneWrap}>
          <PartyPopper size={52} color={colors.emerald400} />
          <Text style={styles.doneTitle}>
            {done.state === "WAITLISTED" ? "You're on the waitlist!" : "Team registered! 🎉"}
          </Text>
          <Text style={styles.doneBody}>
            {done.state === "WAITLISTED"
              ? "The tournament is full right now — we'll notify you when a spot opens."
              : `${teamName} is in. Watch for the pool reveal and your fixtures!`}
          </Text>
          {done.dueAtVenue > 0 && done.state !== "WAITLISTED" && (
            <Text style={styles.dueNote}>
              ₹{done.dueAtVenue.toLocaleString("en-IN")} payable at the venue before your first match.
            </Text>
          )}
          <Pressable onPress={() => navigation.goBack()} style={styles.primaryBtn}>
            <Text style={styles.primaryText}>Back to the tournament</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.h1}>Register — {t?.name || ""}</Text>

          <View style={styles.card}>
            <Text style={styles.label}>Team Name *</Text>
            <TextInput
              style={styles.input}
              placeholder="Mathura Strikers"
              placeholderTextColor={colors.zinc600}
              value={teamName}
              onChangeText={setTeamName}
            />
            <Text style={[styles.label, { marginTop: 12 }]}>Team Colour</Text>
            <View style={styles.swatches}>
              {COLORS.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setColor(c)}
                  style={[styles.swatch, { backgroundColor: c }, color === c && styles.swatchActive]}
                />
              ))}
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.label}>Squad ({filled.length} players) — Player 1 is captain</Text>
              <Pressable onPress={() => setMembers((m) => [...m, ""])}>
                <Plus size={18} color={colors.emerald400} />
              </Pressable>
            </View>
            {members.map((m, i) => (
              <View key={i} style={styles.memberRow}>
                <View style={styles.memberIdx}>
                  <Text style={{ color: colors.zinc500, fontSize: 12 }}>{i + 1}</Text>
                </View>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder={i === 0 ? "Captain's playing name" : `Player ${i + 1}`}
                  placeholderTextColor={colors.zinc600}
                  value={m}
                  onChangeText={(v) => setMembers((arr) => arr.map((x, j) => (j === i ? v : x)))}
                />
                {members.length > 1 && (
                  <Pressable onPress={() => setMembers((arr) => arr.filter((_, j) => j !== i))} hitSlop={8}>
                    <Trash2 size={17} color={colors.zinc600} />
                  </Pressable>
                )}
              </View>
            ))}
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Captain Name *</Text>
            <TextInput style={styles.input} value={captainName} onChangeText={setCaptainName} placeholderTextColor={colors.zinc600} />
            <Text style={[styles.label, { marginTop: 12 }]}>Captain Phone *</Text>
            <TextInput
              style={styles.input}
              keyboardType="phone-pad"
              value={captainPhone}
              onChangeText={setCaptainPhone}
              placeholderTextColor={colors.zinc600}
            />
          </View>

          {t && t.feeMode !== "FREE" && (
            <View style={styles.card}>
              {t.allowCoupons && (
                <>
                  <Text style={styles.label}>Coupon code (optional)</Text>
                  <TextInput
                    style={styles.input}
                    autoCapitalize="characters"
                    placeholder="EARLYBIRD"
                    placeholderTextColor={colors.zinc600}
                    value={coupon}
                    onChangeText={setCoupon}
                  />
                </>
              )}
              {pointsPreview && pointsPreview.maxPoints > 0 && (
                <Pressable
                  onPress={() => setUsePoints((x) => !x)}
                  style={[styles.pointsRow, usePoints && { borderColor: "rgba(251,191,36,0.5)" }]}
                >
                  <View style={[styles.checkbox, usePoints && styles.checkboxOn]} />
                  <Text style={{ color: colors.zinc300, fontSize: 13, flex: 1 }}>
                    Use {pointsPreview.maxPoints.toLocaleString("en-IN")} points (−₹
                    {Math.round(pointsPreview.maxPaise / 100).toLocaleString("en-IN")})
                  </Text>
                </Pressable>
              )}
              {dqrAvailable && (
                <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                  {(
                    [
                      ["upi", "UPI QR"],
                      ["razorpay", "Card / Netbanking"],
                    ] as const
                  ).map(([v, label]) => (
                    <Pressable
                      key={v}
                      onPress={() => setMethod(v)}
                      style={[styles.methodBtn, method === v && styles.methodBtnActive]}
                    >
                      <Text style={{ color: method === v ? colors.emerald400 : colors.zinc400, fontSize: 13 }}>
                        {label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          )}

          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable
            onPress={submit}
            disabled={!canSubmit || busy}
            style={[styles.primaryBtn, (!canSubmit || busy) && { opacity: 0.4 }]}
          >
            <Text style={styles.primaryText}>
              {busy
                ? "Please wait…"
                : payablePreview > 0
                  ? `Pay ₹${payablePreview.toLocaleString("en-IN")} & Register`
                  : "Register Team"}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 60 },
  h1: { color: colors.foreground, fontSize: 18, fontWeight: "800" },
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 12,
  },
  label: { color: colors.zinc400, fontSize: 12, marginBottom: 6 },
  input: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.zinc900,
    color: colors.foreground,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: "transparent" },
  swatchActive: { borderColor: colors.foreground },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  memberRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  memberIdx: {
    width: 28,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.zinc900,
    alignItems: "center",
    justifyContent: "center",
  },
  pointsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.25)",
    backgroundColor: "rgba(251,191,36,0.05)",
    borderRadius: radius.lg,
    padding: 10,
    marginTop: 12,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.zinc600,
  },
  checkboxOn: { backgroundColor: "#f59e0b", borderColor: "#f59e0b" },
  methodBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: 10,
    alignItems: "center",
  },
  methodBtnActive: { borderColor: colors.emerald500_30, backgroundColor: colors.emerald500_10 },
  error: { color: "#f87171", fontSize: 13 },
  primaryBtn: {
    backgroundColor: colors.emerald500,
    borderRadius: radius.lg,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  primaryText: { color: "#ffffff", fontWeight: "700", fontSize: 15 },
  qr: { width: 240, height: 240, borderRadius: 16, backgroundColor: "#ffffff" },
  doneWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20, gap: 12 },
  doneTitle: { color: colors.foreground, fontSize: 20, fontWeight: "800", textAlign: "center" },
  doneBody: { color: colors.zinc400, fontSize: 14, textAlign: "center", lineHeight: 20 },
  dueNote: { color: "#fbbf24", fontSize: 13, textAlign: "center" },
});
