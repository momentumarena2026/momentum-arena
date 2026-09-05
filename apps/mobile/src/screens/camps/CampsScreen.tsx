import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import RazorpayCheckout from "react-native-razorpay";
import { CalendarDays, Clock, Users, IndianRupee } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Image } from "react-native";
import { Text } from "../../components/ui/Text";
import { sportTheme } from "../../lib/sport-theme";
import { env } from "../../config/env";
import { Skeleton } from "../../components/ui/Skeleton";
import { Button } from "../../components/ui/Button";
import { colors, radius, spacing } from "../../theme";
import { useAuth } from "../../providers/AuthProvider";
import { formatRupees } from "../../lib/format";
import { fetchJoinedCampIds,
  fetchCamps,
  initiateCampDqr,
  pollCampDqr,
  registerForCamp,
  verifyCampPayment,
  type CampSummary,
} from "../../lib/camps";
import {
  trackCampsHubView,
  trackCampRegisterStarted,
  trackCampRegisterCompleted,
} from "../../lib/analytics";

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

/**
 * What the customer pays now — mirrors onlinePayable on the server, plus
 * the one-time joining fee when this is their first registration.
 *
 * The joining fee is NOT split by the advance percentage. An advance is a
 * part-payment of a recurring price; a joining fee is a one-off the venue
 * has already incurred, and splitting it would put a one-time charge on a
 * bill the customer expects to be monthly.
 */
function payNowFor(c: CampSummary, joining: number): number {
  if (c.feeMode === "FREE" || c.fee <= 0) return joining;
  if (c.feeMode === "ADVANCE") {
    return Math.max(1, Math.round((c.fee * c.advancePct) / 100)) + joining;
  }
  return c.fee + joining;
}

export function CampsScreen() {
  // A promo banner or deep link can name a camp. The sheet is opened
  // once — `openedFor` — so closing it does not immediately reopen on the
  // next render, which is what makes a deep-linked sheet feel stuck.
  const route = useRoute<RouteProp<{ Camps: { slug?: string } | undefined }, "Camps">>();
  const wantedSlug = route.params?.slug ?? null;
  const openedFor = useRef<string | null>(null);
  // Which camps this customer has already joined, so a returning
  // participant is never quoted a joining fee they will not be charged.
  // Signed out returns empty, which is the right quote for someone the
  // venue cannot recognise.
  const { data: joinedIds } = useQuery({
    queryKey: ["camps-joined"],
    queryFn: fetchJoinedCampIds,
    staleTime: 60 * 1000,
  });
  const joiningFeeFor = useCallback(
    (c: CampSummary) => (joinedIds?.includes(c.id) ? 0 : c.registrationFee ?? 0),
    [joinedIds],
  );
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
  const dqrAvailable = !!q.data?.dqrAvailable;
  // Same two-way choice the booking, pass and tournament funnels offer.
  const [method, setMethod] = useState<"upi" | "razorpay">("razorpay");
  const [dqr, setDqr] = useState<null | {
    qrImage?: string;
    qrString?: string;
    transactionId: string;
    amount: number;
    campSlug: string;
  }>(null);

  useEffect(() => {
    trackCampsHubView();
  }, []);

  // UPI leads once we know the venue accepts it.
  useEffect(() => {
    if (dqrAvailable) setMethod("upi");
  }, [dqrAvailable]);

  // Poll while the QR is up. The S2S callback confirms independently, so
  // this only drives what the screen shows.
  useEffect(() => {
    if (!dqr) return;
    const iv = setInterval(async () => {
      try {
        const d = await pollCampDqr(dqr.transactionId);
        if (d.state === "COMPLETED") {
          clearInterval(iv);
          trackCampRegisterCompleted(dqr.campSlug, "CONFIRMED", "upi");
          setDqr(null);
          setSheet(null);
          setForm({ participantName: "", phone: "", participantAge: "", guardianName: "" });
          void qc.invalidateQueries({ queryKey: ["camps"] });
          Alert.alert("You're registered 🎉", "See you there!");
        } else if (d.state === "FAILED") {
          clearInterval(iv);
          setDqr(null);
          Alert.alert("Payment failed", d.error || "Please try again.");
        }
      } catch {
        /* transient — the next tick retries */
      }
    }, 3500);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dqr]);

  const register = useMutation({
    mutationFn: async (camp: CampSummary) => {
      trackCampRegisterStarted(camp.slug, camp.fee);
      const res = await registerForCamp({
        campId: camp.id,
        participantName: form.participantName.trim(),
        phone: form.phone.trim(),
        participantAge: form.participantAge.trim() || undefined,
        guardianName: form.guardianName.trim() || undefined,
      });
      // Free camp or waitlisted — nothing to pay.
      if (!res.payableNow) {
        trackCampRegisterCompleted(
          camp.slug,
          res.waitlisted ? "WAITLISTED" : "CONFIRMED",
          "none",
        );
        return res;
      }

      // UPI (PhonePe DQR): show the QR; the poll effect finishes the job.
      if (method === "upi") {
        const dq = await initiateCampDqr(res.registrationId);
        if (dq.error) throw new Error(dq.error);
        setDqr({
          qrImage: dq.qrImage,
          qrString: dq.qrString,
          transactionId: dq.transactionId,
          amount: dq.amount,
          campSlug: camp.slug,
        });
        return null;
      }

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
      trackCampRegisterCompleted(camp.slug, "CONFIRMED", "razorpay");
      return res;
    },
    onSuccess: (res) => {
      // null = the UPI QR is now on screen; the poll effect closes out.
      if (!res) return;
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

  const camps = q.data?.camps ?? [];

  // Open the deep-linked camp as soon as the list arrives. Guarded by
  // `openedFor` so dismissing the sheet does not reopen it on the next
  // render — a deep-linked sheet that will not close is worse than one
  // that never opened.
  useEffect(() => {
    if (!wantedSlug || openedFor.current === wantedSlug) return;
    const match = camps.find((c) => c.slug === wantedSlug);
    if (!match) return;
    openedFor.current = wantedSlug;
    setSheet(match);
  }, [wantedSlug, camps]);

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
          const joining = joiningFeeFor(c);
          const now = payNowFor(c, joining);
          // sportTheme falls back to a neutral palette for an unknown
          // or absent sport, so a Taekwondo camp still gets a card that
          // looks deliberate rather than broken.
          const t = sportTheme(c.sport ?? "");
          return (
            <View key={c.id} style={styles.card}>
              {/* Banner — the admin's upload, else the sport's stock
                  photo. Same treatment as the web card. */}
              <View style={styles.banner}>
                <Image
                  source={{ uri: c.bannerImageUrl || `${env.apiUrl}${t.imagePath}` }}
                  style={styles.bannerImg}
                  resizeMode="cover"
                />
                {/* Two stacked scrims instead of a gradient — this app has
                    no expo-linear-gradient, and a soft two-step fade is
                    enough to keep the title legible over any photo. */}
                <View style={[styles.bannerFade, styles.bannerFadeSoft]} />
                <View style={[styles.bannerFade, styles.bannerFadeDeep]} />
                <View style={styles.bannerBody}>
                  <View style={styles.chipRow}>
                    <View
                      style={[
                        styles.sportChip,
                        { backgroundColor: t.chipBg, borderColor: t.chipBorder },
                      ]}
                    >
                      {/* A camp without a sport shows its own name rather
                          than borrowing a sport's label — calling a
                          Taekwondo camp "CRICKET" is worse than saying
                          nothing. */}
                      <Text variant="tiny" weight="700" color={t.hex}>
                        {c.sport ? `${t.emoji} ${t.label.toUpperCase()}` : "CAMP"}
                      </Text>
                    </View>
                    {open && !full && c.seatsLeft <= 5 ? (
                      <View style={styles.lowChip}>
                        <Text variant="tiny" weight="700" color="#fca5a5">
                          {c.seatsLeft} LEFT
                        </Text>
                      </View>
                    ) : null}
                    {!open ? (
                      <View style={styles.closedChip}>
                        <Text variant="tiny" weight="700" color={colors.zinc300}>
                          {c.status === "ONGOING" ? "RUNNING" : "CLOSED"}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text
                    variant="bodyStrong"
                    color={colors.foreground}
                    style={{ marginTop: 4 }}
                    numberOfLines={2}
                  >
                    {c.name}
                  </Text>
                </View>
              </View>

              <View style={styles.cardBody}>
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
                  {c.fee > 0 ? `${formatRupees(c.fee)}/month` : "Free"}
                  {/* Named as a joining fee, not just added to the total.
                      A customer seeing a bigger number than the advertised
                      monthly price needs to know WHY, and that it happens
                      once. */}
                  {joining > 0 ? ` + ${formatRupees(joining)} joining (one-time)` : ""}
                  {now > 0 && now < c.fee + joining
                    ? ` — ${formatRupees(now)} to book`
                    : ""}
                </Row>
              </View>

              {/* Capacity — easier to feel than to read off a number. */}
              <View style={styles.capTrack}>
                <View
                  style={[
                    styles.capFill,
                    {
                      backgroundColor: t.hex,
                      width: `${Math.min(100, Math.round(((c.capacity - c.seatsLeft) / Math.max(1, c.capacity)) * 100))}%`,
                    },
                  ]}
                />
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

            {dqrAvailable && sheet.seatsLeft > 0 && payNowFor(sheet, joiningFeeFor(sheet)) > 0 && (
              <View style={styles.methodRow}>
                {(["upi", "razorpay"] as const).map((v) => (
                  <Pressable
                    key={v}
                    onPress={() => setMethod(v)}
                    style={[styles.methodBtn, method === v && styles.methodBtnActive]}
                  >
                    <Text
                      variant="small"
                      color={method === v ? colors.emerald400 : colors.zinc400}
                    >
                      {v === "upi" ? "UPI" : "Card / Netbanking"}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}

            <Button
              label={
                sheet.seatsLeft <= 0
                  ? "Join waitlist"
                  : payNowFor(sheet, joiningFeeFor(sheet)) > 0
                    ? `Pay ${formatRupees(payNowFor(sheet, joiningFeeFor(sheet)))} & register`
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

      {/* UPI QR — replaces the form until the payment lands or is cancelled. */}
      {dqr && (
        <View style={styles.sheetWrap}>
          <View style={styles.backdrop} />
          <View style={[styles.sheet, { alignItems: "center", gap: spacing["3"] }]}>
            <Text variant="bodyStrong" color={colors.foreground}>
              Scan to pay {formatRupees(dqr.amount)}
            </Text>
            <Text variant="small" color={colors.zinc400}>
              Use any UPI app — this screen confirms automatically.
            </Text>
            {dqr.qrImage ? (
              <Image source={{ uri: dqr.qrImage }} style={styles.qr} />
            ) : (
              <Text variant="tiny" color={colors.zinc400}>
                {dqr.qrString}
              </Text>
            )}
            <View style={styles.waiting}>
              <ActivityIndicator size="small" color={colors.emerald400} />
              <Text variant="small" color={colors.zinc400}>
                Waiting for payment…
              </Text>
            </View>
            <Button
              label="Cancel and choose another method"
              variant="ghost"
              size="sm"
              onPress={() => setDqr(null)}
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
  banner: { height: 128, width: "100%", position: "relative" },
  bannerImg: { width: "100%", height: "100%" },
  bannerFade: { position: "absolute", left: 0, right: 0, bottom: 0 },
  bannerFadeSoft: { height: 96, backgroundColor: "rgba(9,9,11,0.45)" },
  bannerFadeDeep: { height: 52, backgroundColor: "rgba(9,9,11,0.72)" },
  bannerBody: { position: "absolute", left: 14, right: 14, bottom: 10 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  sportChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  lowChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderColor: "rgba(248,113,113,0.4)",
    backgroundColor: "rgba(248,113,113,0.15)",
  },
  closedChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderColor: colors.zinc700,
    backgroundColor: "rgba(9,9,11,0.7)",
  },
  cardBody: { padding: 14, gap: 8 },
  capTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.zinc800,
    overflow: "hidden",
  },
  capFill: { height: "100%", borderRadius: 2 },
  card: {
    // No padding + overflow hidden so the banner runs edge to edge and
    // gets clipped by the card's own corner radius; the text below sits
    // in cardBody, which carries the padding instead.
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    overflow: "hidden",
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
  methodRow: { flexDirection: "row", gap: spacing["2"] },
  methodBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing["2"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
  },
  methodBtnActive: {
    borderColor: colors.emerald500_30,
    backgroundColor: colors.emerald500_10,
  },
  qr: {
    width: 220,
    height: 220,
    borderRadius: radius.lg,
    backgroundColor: "#fff",
  },
  waiting: { flexDirection: "row", alignItems: "center", gap: spacing["2"] },
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
