import { useState } from "react";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import RazorpayCheckout from "react-native-razorpay";
import { CalendarDays, Clock, Users, IndianRupee } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { Button } from "../../components/ui/Button";
import { colors, radius, spacing } from "../../theme";
import { useAuth } from "../../providers/AuthProvider";
import { formatRupees } from "../../lib/format";
import {
  fetchCamps,
  registerForCamp,
  verifyCampPayment,
  type CampSummary,
} from "../../lib/camps";

/**
 * Camps: browse and register, mirroring /camps on the web. Registration
 * goes through the same route the web uses, so pricing, capacity and the
 * waitlist can't drift between platforms.
 */

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const istDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });

const hour = (h: number) => {
  const am = h < 12 || h === 24;
  const v = h % 12 === 0 ? 12 : h % 12;
  return `${v}${am ? "am" : "pm"}`;
};

/** What the customer pays now — mirrors onlinePayable on the server. */
function payNowFor(c: CampSummary): number {
  if (c.feeMode === "FREE" || c.fee <= 0) return 0;
  if (c.feeMode === "ADVANCE") {
    return Math.max(1, Math.round((c.fee * c.advancePct) / 100));
  }
  return c.fee;
}

export function CampsScreen() {
  const qc = useQueryClient();
  const { state: authState } = useAuth();
  const [sheet, setSheet] = useState<CampSummary | null>(null);
  const [form, setForm] = useState({
    participantName: "",
    phone: "",
    participantAge: "",
    guardianName: "",
  });

  const q = useQuery({ queryKey: ["camps"], queryFn: fetchCamps });

  const register = useMutation({
    mutationFn: async (camp: CampSummary) => {
      const res = await registerForCamp({
        campId: camp.id,
        participantName: form.participantName.trim(),
        phone: form.phone.trim(),
        participantAge: form.participantAge.trim() || undefined,
        guardianName: form.guardianName.trim() || undefined,
      });
      // Free camp or waitlisted — nothing to pay.
      if (!res.payableNow) return res;

      const paid = (await RazorpayCheckout.open({
        key: res.keyId!,
        amount: Math.round(res.payableNow * 100),
        currency: "INR",
        name: "Momentum Arena",
        description: res.campName ?? camp.name,
        order_id: res.orderId!,
        prefill: {
          name: authState.user?.name ?? "",
          email: authState.user?.email ?? "",
          contact: authState.user?.phone ?? "",
        },
        theme: { color: colors.emerald500 },
      })) as {
        razorpay_order_id?: string;
        razorpay_payment_id?: string;
        razorpay_signature?: string;
      };

      const v = await verifyCampPayment({
        razorpayOrderId: paid.razorpay_order_id ?? "",
        razorpayPaymentId: paid.razorpay_payment_id ?? "",
        razorpaySignature: paid.razorpay_signature ?? "",
      });
      if (v.error) throw new Error(v.error);
      return res;
    },
    onSuccess: (res) => {
      setSheet(null);
      setForm({ participantName: "", phone: "", participantAge: "", guardianName: "" });
      void qc.invalidateQueries({ queryKey: ["camps"] });
      Alert.alert(
        res.waitlisted ? "You're on the waitlist" : "You're registered 🎉",
        res.waitlisted
          ? "The camp is full — we'll be in touch the moment a spot opens."
          : "See you there!",
      );
    },
    onError: (err) => {
      const e = err as { code?: number; description?: string } & Error;
      // Razorpay's dismiss looks like an error; don't shout about it.
      if (e?.code === 2 || e?.description?.toLowerCase().includes("cancel")) return;
      Alert.alert("Couldn't register", e?.description || e.message || "Try again.");
    },
  });

  const camps = q.data ?? [];

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={q.isRefetching}
            onRefresh={() => void q.refetch()}
            tintColor={colors.emerald400}
          />
        }
      >
        <View style={styles.header}>
          <Text variant="title" color={colors.foreground}>
            Camps 🏕️
          </Text>
          <Text variant="small" color={colors.zinc400}>
            Structured coaching over a few weeks — fixed days, fixed times,
            a coach who knows your name.
          </Text>
        </View>

        {q.isLoading && (
          <View style={styles.loading}>
            {[0, 1].map((i) => (
              <Skeleton key={i} height={150} rounded="xl" />
            ))}
          </View>
        )}

        {!q.isLoading && camps.length === 0 && (
          <Text variant="small" color={colors.zinc500} style={styles.empty}>
            No camps are open right now. Check back soon.
          </Text>
        )}

        {camps.map((c) => {
          const open = c.status === "REGISTRATIONS_OPEN";
          const full = c.seatsLeft <= 0;
          const now = payNowFor(c);
          return (
            <View key={c.id} style={styles.card}>
              <Text
                variant="tiny"
                weight="700"
                color={colors.emerald400}
                style={styles.sport}
              >
                {c.sport}
              </Text>
              <Text variant="bodyStrong" color={colors.foreground}>
                {c.name}
              </Text>
              {c.description ? (
                <Text variant="small" color={colors.zinc400} numberOfLines={2}>
                  {c.description}
                </Text>
              ) : null}

              <View style={styles.rows}>
                <Row icon={<CalendarDays size={14} color={colors.zinc500} />}>
                  {istDate(c.startDate)} – {istDate(c.endDate)}
                </Row>
                <Row icon={<Clock size={14} color={colors.zinc500} />}>
                  {c.daysOfWeek.map((d) => DAYS[d]).join(", ")} ·{" "}
                  {hour(c.startHour)}–{hour(c.endHour)}
                </Row>
                <Row icon={<Users size={14} color={colors.zinc500} />}>
                  {full ? "Full" : `${c.seatsLeft} of ${c.capacity} spots left`}
                </Row>
                <Row icon={<IndianRupee size={14} color={colors.emerald400} />}>
                  {c.fee > 0 ? formatRupees(c.fee) : "Free"}
                  {now > 0 && now < c.fee
                    ? ` — ${formatRupees(now)} to book`
                    : ""}
                </Row>
              </View>

              {open && (!full || c.waitlistEnabled) ? (
                <Button
                  label={full ? "Join waitlist" : "Register"}
                  size="sm"
                  variant="primary"
                  onPress={() => setSheet(c)}
                />
              ) : (
                <Text variant="small" color={colors.zinc500}>
                  {open ? "This camp is full." : "Registrations are closed."}
                </Text>
              )}
            </View>
          );
        })}
      </ScrollView>

      {/* Registration sheet */}
      {sheet && (
        <View style={styles.sheetWrap}>
          <Pressable style={styles.backdrop} onPress={() => setSheet(null)} />
          <View style={styles.sheet}>
            <Text variant="bodyStrong" color={colors.foreground}>
              {sheet.seatsLeft <= 0 ? "Join the waitlist" : "Register"}
            </Text>
            <Text variant="small" color={colors.zinc400}>
              {sheet.name}
            </Text>

            {(
              [
                ["participantName", "Participant name *"],
                ["phone", "Phone *"],
                ["participantAge", "Age (optional)"],
                ["guardianName", "Guardian (for minors)"],
              ] as const
            ).map(([key, ph]) => (
              <TextInput
                key={key}
                style={styles.input}
                placeholder={ph}
                placeholderTextColor={colors.zinc600}
                keyboardType={
                  key === "phone"
                    ? "phone-pad"
                    : key === "participantAge"
                      ? "numeric"
                      : "default"
                }
                value={form[key]}
                onChangeText={(v) => setForm((f) => ({ ...f, [key]: v }))}
              />
            ))}

            <Button
              label={
                sheet.seatsLeft <= 0
                  ? "Join waitlist"
                  : payNowFor(sheet) > 0
                    ? `Pay ${formatRupees(payNowFor(sheet))} & register`
                    : "Register"
              }
              variant="primary"
              loading={register.isPending}
              disabled={
                register.isPending ||
                !form.participantName.trim() ||
                !form.phone.trim()
              }
              onPress={() => register.mutate(sheet)}
            />
            <Button
              label="Cancel"
              variant="ghost"
              size="sm"
              disabled={register.isPending}
              onPress={() => setSheet(null)}
            />
          </View>
        </View>
      )}
    </Screen>
  );
}

function Row({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.row}>
      {icon}
      <Text variant="small" color={colors.zinc300} style={styles.rowText}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing["5"],
    gap: spacing["4"],
    paddingBottom: spacing["10"],
  },
  header: { gap: spacing["1"] },
  loading: { gap: spacing["4"] },
  empty: { marginTop: spacing["6"], textAlign: "center" },
  card: {
    gap: spacing["2"],
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["4"],
  },
  sport: { letterSpacing: 1 },
  rows: { gap: 6, marginTop: spacing["1"] },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowText: { flex: 1 },
  sheetWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "flex-end",
  },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.7)",
  },
  sheet: {
    gap: spacing["3"],
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.card,
    padding: spacing["5"],
  },
  input: {
    height: 44,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc700,
    backgroundColor: colors.zinc900,
    paddingHorizontal: spacing["3"],
    color: colors.foreground,
    fontSize: 14,
  },
});
