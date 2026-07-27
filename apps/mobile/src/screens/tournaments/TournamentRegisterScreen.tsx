import { useMemo, useState } from "react";
import {
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
import { Plus, Trash2, PartyPopper } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { colors, radius } from "../../theme";
import { getTournament, registerTeam, verifyEntryPayment } from "../../lib/tournaments";
import { useAuth } from "../../providers/AuthProvider";
import type { AccountStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<AccountStackParamList>;
type Rt = RouteProp<AccountStackParamList, "TournamentRegister">;

const COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#10b981", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899", "#71717a"];

export function TournamentRegisterScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const { slug } = route.params;
  const { state: authState } = useAuth();
  const user = authState.user;
  const queryClient = useQueryClient();

  const { data } = useQuery({ queryKey: ["tournament", slug], queryFn: () => getTournament(slug) });

  const [teamName, setTeamName] = useState("");
  const [color, setColor] = useState(COLORS[4]);
  const [members, setMembers] = useState<string[]>(["", ""]);
  const [captainName, setCaptainName] = useState(user?.name || "");
  const [captainPhone, setCaptainPhone] = useState(user?.phone || "");
  const [coupon, setCoupon] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { state: string; dueAtVenue: number }>(null);

  const t = data?.tournament;
  const filled = useMemo(() => members.map((m) => m.trim()).filter(Boolean), [members]);
  const canSubmit =
    !!t &&
    teamName.trim().length >= 2 &&
    filled.length > 0 &&
    captainName.trim().length > 0 &&
    captainPhone.replace(/\D/g, "").length >= 10;

  const submit = async () => {
    if (!t || !canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await registerTeam({
        tournamentId: t.id,
        teamName,
        color,
        members: filled,
        captainName,
        captainPhone,
        couponCode: coupon.trim() || null,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.state !== "PENDING_PAYMENT") {
        setDone({ state: res.state || "CONFIRMED", dueAtVenue: res.dueAtVenue || 0 });
        queryClient.invalidateQueries({ queryKey: ["tournament", slug] });
        return;
      }
      // Pay via Razorpay native checkout.
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
        return;
      }
      setDone({ state: "CONFIRMED", dueAtVenue: res.dueAtVenue || 0 });
      queryClient.invalidateQueries({ queryKey: ["tournament", slug] });
    } catch (e) {
      const msg =
        e && typeof e === "object" && "description" in e
          ? String((e as { description?: string }).description || "Payment cancelled")
          : e instanceof Error
            ? e.message
            : "Something went wrong";
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

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
              <Text style={styles.label}>
                Squad ({filled.length}
                {t ? `/${t.totalTeams ? "" : ""}` : ""} players) — Player 1 is captain
              </Text>
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

          {t && t.status === "REG_OPEN" && (
            <View style={styles.card}>
              <Text style={styles.label}>Coupon code (optional)</Text>
              <TextInput
                style={[styles.input, { textTransform: "uppercase" }]}
                autoCapitalize="characters"
                placeholder="EARLYBIRD"
                placeholderTextColor={colors.zinc600}
                value={coupon}
                onChangeText={setCoupon}
              />
            </View>
          )}

          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable
            onPress={submit}
            disabled={!canSubmit || busy}
            style={[styles.primaryBtn, (!canSubmit || busy) && { opacity: 0.4 }]}
          >
            <Text style={styles.primaryText}>{busy ? "Please wait…" : "Register & Pay"}</Text>
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
  error: { color: "#f87171", fontSize: 13 },
  primaryBtn: {
    backgroundColor: colors.emerald500,
    borderRadius: radius.lg,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  primaryText: { color: colors.foreground, fontWeight: "700", fontSize: 15 },
  doneWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20, gap: 12 },
  doneTitle: { color: colors.foreground, fontSize: 20, fontWeight: "800", textAlign: "center" },
  doneBody: { color: colors.zinc400, fontSize: 14, textAlign: "center", lineHeight: 20 },
  dueNote: { color: "#fbbf24", fontSize: 13, textAlign: "center" },
});
