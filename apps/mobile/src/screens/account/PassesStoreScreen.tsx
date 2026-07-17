import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import RazorpayCheckout from "react-native-razorpay";
import type {
  PaymentErrorData,
  PaymentSuccessData,
} from "react-native-razorpay/src/types";
import { CreditCard, ShieldCheck, Smartphone, Ticket, X } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { PassClock } from "../../components/passes/PassClock";
import { SportIcon } from "../../components/passes/SportIcon";
import { Text } from "../../components/ui/Text";
import {
  DqrCheckout,
  type DqrEndpoints,
} from "../../components/payment/DqrCheckout";
import { colors, spacing } from "../../theme";
import { formatRupees } from "../../lib/format";
import { ApiError } from "../../lib/api";
import { bookingApi } from "../../lib/booking";
import { passesApi, type PassPlanCard } from "../../lib/passes";
import { useAuth } from "../../providers/AuthProvider";
import {
  trackPassPurchaseCompleted,
  trackPassPurchaseStarted,
} from "../../lib/analytics";
import type { AccountStackParamList } from "../../navigation/types";

/**
 * Pass storefront — mobile mirror of the web /passes page. Plan cards
 * (bulk hours at a discount), then a purchase sheet: start-date chips +
 * UPI (default, PhonePe DQR) or Card/Netbanking (Razorpay). Money-first
 * on both paths — the pass only materialises after capture.
 */

type Nav = NativeStackNavigationProp<AccountStackParamList>;

const SPORT_ACCENT: Record<string, string> = {
  CRICKET: "#34d399",
  FOOTBALL: "#60a5fa",
  PICKLEBALL: "#facc15",
};

const fmtH = (h: number) => `${h.toFixed(1).replace(/\.0$/, "")}`;

/** Next `count` days as IST YYYY-MM-DD chips (Today first). */
function buildStartDays(count: number) {
  const days: { value: string; label: string }[] = [];
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const d = new Date(now + i * 86_400_000);
    const value = d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const label =
      i === 0
        ? "Today"
        : i === 1
          ? "Tomorrow"
          : d.toLocaleDateString("en-IN", {
              timeZone: "Asia/Kolkata",
              weekday: "short",
              day: "numeric",
              month: "short",
            });
    days.push({ value, label });
  }
  return days;
}

function PlanCard({
  plan,
  onBuy,
}: {
  plan: PassPlanCard;
  onBuy: () => void;
}) {
  const accent = SPORT_ACCENT[plan.sport] ?? "#34d399";
  const sportTitle =
    plan.sport.charAt(0) + plan.sport.slice(1).toLowerCase() +
    (plan.isBowling ? " · Bowling Machine" : "");
  const restricted = !!plan.bandsSummary && plan.bandsSummary !== "All hours";
  return (
    <View style={[styles.planCard, { borderColor: `${accent}33` }]}>
      {/* Ticket stub — tinted header with sport tile + hours dial,
          mirroring the web /passes card. */}
      <View style={[styles.stub, { backgroundColor: `${accent}14` }]}>
        <View style={styles.stubTop}>
          <View style={[styles.sportTile, { backgroundColor: `${accent}1f` }]}>
            <SportIcon sport={plan.sport} size={28} color={accent} />
          </View>
          <View style={styles.dialCol}>
            <PassClock totalHours={plan.hours} accent={accent} size={80} stroke={8} />
            {plan.discountPercent > 0 && (
              <View style={[styles.saveBadge, { backgroundColor: `${accent}22` }]}>
                <Text style={[styles.saveText, { color: accent }]}>
                  Save {plan.discountPercent}%
                </Text>
              </View>
            )}
          </View>
        </View>
        <Text style={styles.sportLabel}>{sportTitle}</Text>
        <Text style={styles.planName}>{plan.name}</Text>
      </View>

      {/* Perforation — side notches + dashed divider */}
      <View style={styles.perforation}>
        <View style={[styles.notch, styles.notchLeft]} />
        <View style={styles.dashes} />
        <View style={[styles.notch, styles.notchRight]} />
      </View>

      {/* Body */}
      <View style={styles.body}>
        <View style={styles.priceRow}>
          <Text style={styles.price}>{formatRupees(plan.price)}</Text>
          {plan.baseAmount > plan.price && (
            <Text style={styles.basePrice}>{formatRupees(plan.baseAmount)}</Text>
          )}
        </View>
        <Text style={[styles.hourlyRow, { color: accent }]}>
          {formatRupees(plan.effectiveHourly)}/hr
          {plan.anchorPricePerHour != null ? (
            <Text style={styles.hourlyMuted}>
              {"  instead of "}
              {formatRupees(plan.anchorPricePerHour)}/hr
            </Text>
          ) : null}
        </Text>

        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <ShieldCheck size={13} color={colors.zinc400} />
            <Text style={styles.metaText}>Valid {plan.validityDays} days</Text>
          </View>
          {restricted && (
            <View style={[styles.bandChip, { backgroundColor: `${accent}1f` }]}>
              <Text style={[styles.bandChipText, { color: accent }]}>
                {plan.bandsSummary}
              </Text>
            </View>
          )}
        </View>

        <Pressable
          onPress={onBuy}
          style={({ pressed }) => [
            styles.buyBtn,
            { backgroundColor: accent },
            pressed && { opacity: 0.85 },
          ]}
        >
          <Text style={styles.buyBtnText}>Buy pass</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function PassesStoreScreen() {
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { state } = useAuth();
  const signedInUser = state.status === "signedIn" ? state.user : null;

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["pass-plans"],
    queryFn: () => passesApi.plans(),
  });
  const { data: payCfg } = useQuery({
    queryKey: ["payment-config"],
    queryFn: () => bookingApi.paymentConfig(),
  });
  const dqrEnabled = !!payCfg?.dqrEnabled;

  // Purchase sheet state
  const [buying, setBuying] = useState<PassPlanCard | null>(null);
  const [method, setMethod] = useState<"upi" | "razorpay">("upi");
  const [startDate, setStartDate] = useState<string>(
    () => buildStartDays(1)[0].value,
  );
  const [processing, setProcessing] = useState(false);
  const [showDqr, setShowDqr] = useState(false);

  const startDays = useMemo(() => buildStartDays(31), []);

  function openSheet(plan: PassPlanCard) {
    setBuying(plan);
    setMethod(dqrEnabled ? "upi" : "razorpay");
    setStartDate(startDays[0].value);
    setShowDqr(false);
  }

  function closeSheet() {
    if (processing || showDqr) return;
    setBuying(null);
  }

  function onPassReady(userPassId: string) {
    void queryClient.invalidateQueries({ queryKey: ["my-passes"] });
    setShowDqr(false);
    setBuying(null);
    setProcessing(false);
    navigation.replace("PassDetail", { passId: userPassId });
  }

  // Memoized DQR endpoints — a fresh identity would re-initiate a new
  // PhonePe transaction on every render (see DqrCheckout).
  const buyingId = buying?.id ?? null;
  const dqrEndpoints: DqrEndpoints = useMemo(
    () => ({
      initiate: async () => {
        if (!buyingId) return { error: "No plan selected" };
        const r = await passesApi.dqrInitiate(buyingId, startDate);
        return { ...r, confirmedId: null };
      },
      status: async (txn: string) => {
        const r = await passesApi.dqrStatus(txn);
        return { state: r.state, confirmedId: r.userPassId ?? null };
      },
    }),
    [buyingId, startDate],
  );

  async function payWithRazorpay(plan: PassPlanCard) {
    setProcessing(true);
    try {
      trackPassPurchaseStarted(plan.id, plan.price, "razorpay");
      const init = await passesApi.createOrder(plan.id, startDate);

      let success: PaymentSuccessData;
      try {
        success = (await RazorpayCheckout.open({
          key: init.keyId,
          amount: Math.round(init.amount * 100), // SDK wants paise
          currency: "INR",
          name: "Momentum Arena",
          description: init.planName,
          order_id: init.orderId,
          prefill: {
            name: signedInUser?.name ?? "",
            email: signedInUser?.email ?? "",
            contact: signedInUser?.phone ?? "",
          },
          theme: { color: colors.emerald500 },
        })) as PaymentSuccessData;
      } catch (err) {
        const e = err as PaymentErrorData;
        if (e?.code === 2 || e?.description?.toLowerCase().includes("cancel")) {
          return; // dismissed — order simply goes unpaid
        }
        throw new Error(e?.description || "Payment failed");
      }

      const verify = await passesApi.verifyPayment({
        planId: plan.id,
        razorpayOrderId: success.razorpay_order_id ?? "",
        razorpayPaymentId: success.razorpay_payment_id ?? "",
        razorpaySignature: success.razorpay_signature ?? "",
        startDate,
      });
      trackPassPurchaseCompleted(plan.id, plan.price, "razorpay");
      onPassReady(verify.userPassId);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Purchase failed";
      Alert.alert("Purchase failed", msg);
    } finally {
      setProcessing(false);
    }
  }

  function startPayment() {
    if (!buying) return;
    if (method === "upi") {
      trackPassPurchaseStarted(buying.id, buying.price, "upi");
      setShowDqr(true);
    } else {
      void payWithRazorpay(buying);
    }
  }

  const plans = data?.plans ?? [];

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={colors.emerald400}
          />
        }
      >
        <Text style={styles.lede}>
          Buy hours in bulk at a lower rate — share them with your squad and
          let the pass pay at checkout.
        </Text>

        {isLoading ? (
          <View style={styles.emptyBox}>
            <ActivityIndicator color={colors.emerald400} />
          </View>
        ) : plans.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ticket size={28} color={colors.zinc600} />
            <Text style={styles.emptyTitle}>No passes on sale right now</Text>
            <Text style={styles.emptySub}>
              Check back soon — new passes drop here first.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {plans.map((p) => (
              <PlanCard key={p.id} plan={p} onBuy={() => openSheet(p)} />
            ))}
          </View>
        )}
      </ScrollView>

      {/* ── Purchase sheet ── */}
      {buying && !showDqr ? (
        <Modal transparent animationType="slide" visible onRequestClose={closeSheet}>
          <View style={styles.overlay}>
            <Pressable style={styles.backdrop} onPress={closeSheet} />
            <View
              style={[
                styles.sheet,
                { paddingBottom: Math.max(insets.bottom, spacing["4"]) },
              ]}
            >
              <View style={styles.sheetHeader}>
                <View style={styles.sheetHeaderLeft}>
                  <Text style={styles.sheetTitle} numberOfLines={1}>
                    {buying.name}
                  </Text>
                  <Text style={styles.sheetSub}>
                    {fmtH(buying.hours)} hrs · valid {buying.validityDays} days
                  </Text>
                </View>
                <Text style={styles.sheetAmount}>
                  {formatRupees(buying.price)}
                </Text>
                <Pressable onPress={closeSheet} hitSlop={8} style={styles.closeBtn}>
                  <X size={20} color={colors.zinc500} />
                </Pressable>
              </View>
              <View style={styles.sheetDivider} />

              {/* Start date */}
              <Text style={styles.fieldLabel}>Pass starts on</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.dayChips}
              >
                {startDays.map((d) => (
                  <Pressable
                    key={d.value}
                    onPress={() => setStartDate(d.value)}
                    style={[
                      styles.dayChip,
                      startDate === d.value && styles.dayChipOn,
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayChipText,
                        startDate === d.value && styles.dayChipTextOn,
                      ]}
                    >
                      {d.label}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              <Text style={styles.fieldHint}>
                Validity counts from this date — book any session on or after
                it.
              </Text>

              {/* Method */}
              <Text style={styles.fieldLabel}>Pay with</Text>
              <View style={styles.methodCol}>
                {dqrEnabled && (
                  <Pressable
                    onPress={() => setMethod("upi")}
                    style={[
                      styles.methodTile,
                      method === "upi" && styles.methodTileOn,
                    ]}
                  >
                    <Smartphone
                      size={18}
                      color={method === "upi" ? colors.emerald400 : colors.zinc400}
                    />
                    <View style={styles.methodInfo}>
                      <Text style={styles.methodName}>UPI</Text>
                      <Text style={styles.methodMeta}>
                        GPay, PhonePe, any UPI app — auto-confirms
                      </Text>
                    </View>
                    <View style={styles.recBadge}>
                      <Text style={styles.recText}>Recommended</Text>
                    </View>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => setMethod("razorpay")}
                  style={[
                    styles.methodTile,
                    method === "razorpay" && styles.methodTileOn,
                  ]}
                >
                  <CreditCard
                    size={18}
                    color={
                      method === "razorpay" ? colors.emerald400 : colors.zinc400
                    }
                  />
                  <View style={styles.methodInfo}>
                    <Text style={styles.methodName}>Card / Netbanking</Text>
                    <Text style={styles.methodMeta}>
                      Via Razorpay — cards, netbanking, wallets
                    </Text>
                  </View>
                </Pressable>
              </View>

              <Pressable
                onPress={startPayment}
                disabled={processing}
                style={({ pressed }) => [
                  styles.payBtn,
                  (processing || pressed) && { opacity: 0.85 },
                ]}
              >
                {processing ? (
                  <ActivityIndicator size="small" color="#022c22" />
                ) : (
                  <Text style={styles.payBtnText}>
                    Pay {formatRupees(buying.price)}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </Modal>
      ) : null}

      {/* ── UPI DQR sheet ── */}
      {buying && showDqr ? (
        <DqrCheckout
          amount={buying.price}
          endpoints={dqrEndpoints}
          successNote="Your pass is ready"
          onConfirmed={(userPassId) => {
            if (buying) {
              trackPassPurchaseCompleted(buying.id, buying.price, "upi");
            }
            onPassReady(userPassId);
          }}
          onCancel={() => setShowDqr(false)}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing["4"],
    paddingBottom: spacing["8"],
  },
  lede: {
    fontSize: 13,
    color: colors.zinc400,
    lineHeight: 19,
    marginBottom: spacing["4"],
  },
  list: {
    gap: spacing["3"],
  },
  planCard: {
    borderRadius: 16,
    borderWidth: 1,
    backgroundColor: colors.zinc900,
    overflow: "hidden",
  },
  stub: {
    padding: spacing["4"],
  },
  stubTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  sportTile: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  dialCol: {
    alignItems: "center",
    gap: spacing["2"],
  },
  saveBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  saveText: {
    fontSize: 12,
    fontWeight: "700",
  },
  sportLabel: {
    marginTop: spacing["3"],
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.zinc400,
  },
  planName: {
    marginTop: 2,
    fontSize: 17,
    fontWeight: "700",
    lineHeight: 22,
    color: colors.foreground,
  },
  perforation: {
    height: 16,
    justifyContent: "center",
  },
  dashes: {
    marginHorizontal: spacing["4"],
    borderTopWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.zinc700,
  },
  notch: {
    position: "absolute",
    top: 0,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.background,
  },
  notchLeft: { left: -8 },
  notchRight: { right: -8 },
  body: {
    padding: spacing["4"],
    paddingTop: spacing["1"],
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
  },
  price: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.foreground,
  },
  basePrice: {
    fontSize: 14,
    color: colors.zinc500,
    textDecorationLine: "line-through",
  },
  hourlyRow: {
    marginTop: 3,
    fontSize: 13,
    fontWeight: "600",
  },
  hourlyMuted: {
    fontSize: 13,
    fontWeight: "400",
    color: colors.zinc500,
  },
  metaRow: {
    marginTop: spacing["3"],
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing["3"],
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  metaText: {
    fontSize: 12,
    color: colors.zinc400,
  },
  bandChip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  bandChipText: {
    fontSize: 11,
    fontWeight: "600",
  },
  buyBtn: {
    marginTop: spacing["4"],
    borderRadius: 12,
    alignItems: "center",
    paddingVertical: 11,
  },
  buyBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#04140d",
  },
  emptyBox: {
    alignItems: "center",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: "rgba(24,24,27,0.5)",
    paddingVertical: 48,
    paddingHorizontal: spacing["6"],
    gap: spacing["2"],
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.foreground,
  },
  emptySub: {
    fontSize: 12,
    color: colors.zinc500,
    textAlign: "center",
  },

  // Sheet
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: colors.zinc900,
    paddingHorizontal: spacing["4"],
    paddingTop: spacing["4"],
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
  },
  sheetHeaderLeft: {
    flex: 1,
  },
  sheetTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.foreground,
  },
  sheetSub: {
    marginTop: 1,
    fontSize: 11,
    color: colors.zinc500,
  },
  sheetAmount: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.foreground,
  },
  closeBtn: {
    padding: 4,
  },
  sheetDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.zinc800,
    marginVertical: spacing["3"],
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.zinc400,
    marginBottom: spacing["2"],
  },
  dayChips: {
    gap: spacing["2"],
    paddingRight: spacing["4"],
  },
  dayChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.zinc700,
    paddingHorizontal: spacing["3"],
    paddingVertical: 7,
  },
  dayChipOn: {
    borderColor: colors.emerald500,
    backgroundColor: "rgba(16,185,129,0.12)",
  },
  dayChipText: {
    fontSize: 12,
    color: colors.zinc400,
  },
  dayChipTextOn: {
    color: "#6ee7b7",
    fontWeight: "600",
  },
  fieldHint: {
    marginTop: spacing["2"],
    marginBottom: spacing["3"],
    fontSize: 11,
    color: colors.zinc500,
  },
  methodCol: {
    gap: spacing["2"],
    marginBottom: spacing["4"],
  },
  methodTile: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: "rgba(24,24,27,0.6)",
    padding: spacing["3"],
  },
  methodTileOn: {
    borderColor: colors.emerald500,
    backgroundColor: "rgba(16,185,129,0.08)",
  },
  methodInfo: {
    flex: 1,
  },
  methodName: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.foreground,
  },
  methodMeta: {
    marginTop: 1,
    fontSize: 11,
    color: colors.zinc500,
  },
  recBadge: {
    borderRadius: 999,
    backgroundColor: "rgba(16,185,129,0.15)",
    paddingHorizontal: spacing["2"],
    paddingVertical: 3,
  },
  recText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#6ee7b7",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  payBtn: {
    borderRadius: 14,
    backgroundColor: colors.emerald500,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
  payBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#022c22",
  },
});
