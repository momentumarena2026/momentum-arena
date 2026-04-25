import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import {
  CommonActions,
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import RazorpayCheckout from "react-native-razorpay";
import type {
  PaymentErrorData,
  PaymentSuccessData,
  RazorpayOptions,
} from "react-native-razorpay/src/types";
import { AlarmClock, Sparkles } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { DiscountInput } from "../../components/booking/DiscountInput";
import {
  PaymentMethodTiles,
  type PaymentMethodType,
} from "../../components/payment/PaymentMethodTiles";
import {
  AdvancePaymentPicker,
  type AdvancePaymentMethod,
} from "../../components/payment/AdvancePaymentPicker";
import { UpiQrCheckout } from "../../components/payment/UpiQrCheckout";
import { colors, radius, spacing } from "../../theme";
import { bookingApi, type PaymentConfig } from "../../lib/booking";
import { ApiError } from "../../lib/api";
import {
  formatDateLong,
  formatHourRangeCompact,
  formatHoursAsRanges,
  formatRupees,
  sportLabel,
} from "../../lib/format";
import { useAuth } from "../../providers/AuthProvider";
import type {
  BookStackParamList,
  MainTabsParamList,
} from "../../navigation/types";

type Nav = NativeStackNavigationProp<BookStackParamList, "Checkout">;
type Rt = RouteProp<BookStackParamList, "Checkout">;

const FALLBACK_CODE = "FLAT100";

// Mirrors the server's fresh-DB fallback in
// `app/api/mobile/settings/payment-config/route.ts`. Used when the
// fetch fails (e.g. the endpoint isn't deployed yet on the environment
// the dev build is pointing at) so the tiles render with sensible
// defaults instead of an indefinite spinner.
const DEFAULT_PAYMENT_CONFIG: PaymentConfig = {
  activeGateway: "RAZORPAY",
  onlineEnabled: true,
  upiQrEnabled: true,
  advanceEnabled: true,
};

export function CheckoutScreen() {
  const { params } = useRoute<Rt>();
  const navigation = useNavigation<Nav>();
  const qc = useQueryClient();
  const { state } = useAuth();
  const signedInUser = state.status === "signedIn" ? state.user : null;

  // Hold (the SlotHold record we're paying for).
  const { data: hold, isLoading, isError, refetch } = useQuery({
    queryKey: ["hold", params.holdId],
    queryFn: () => bookingApi.hold(params.holdId),
    refetchOnWindowFocus: false,
  });

  // Admin-controlled payment config — tells us which tiles to show + which
  // gateway is active for the "Pay Online" subtitle. Falls back to the
  // same defaults the server returns for a fresh DB so the tiles are
  // never blocked on this network call (previously the checkout could
  // get stuck on a spinner if the endpoint was unreachable).
  const { data: configData } = useQuery({
    queryKey: ["payment-config"],
    queryFn: () => bookingApi.paymentConfig(),
    staleTime: 60_000,
    retry: 1,
  });
  const config: PaymentConfig = configData ?? DEFAULT_PAYMENT_CONFIG;

  const baseAmount = hold?.totalAmount ?? 0;
  const sport = hold?.courtConfig.sport;

  const serverDiscount = hold?.discountAmount ?? 0;
  const serverCouponCode = hold?.couponCode ?? null;
  const appliedAmount = serverDiscount > 0 ? serverDiscount : 0;
  const effectiveAmount = Math.max(0, baseAmount - appliedAmount);

  // Advance is always 50% of the post-discount amount, ceil-rounded.
  const advanceAmount = Math.ceil(effectiveAmount * 0.5);
  const remainingAmount = effectiveAmount - advanceAmount;

  // ── Auto-apply coupons on mount ────────────────────────────────────────────
  // Mirrors web's CheckoutClient:
  //   1. If the user is a new-user (newUserDiscount query returns one), apply it
  //      → newUserApplied=true → emerald "Sparkles" pill.
  //   2. Else fall back to FLAT100.
  //   3. Else continue at full price.
  const autoApplyRanRef = useRef(false);
  const [newUserApplied, setNewUserApplied] = useState(false);
  const [discountLabel, setDiscountLabel] = useState<string | null>(null);

  const newUserDiscountQuery = useQuery({
    queryKey: ["new-user-discount", sport, baseAmount],
    queryFn: () => bookingApi.newUserDiscount(sport!, baseAmount),
    enabled: !!sport && baseAmount > 0 && !!signedInUser,
  });

  const applyCouponMutation = useMutation({
    mutationFn: (code: string) =>
      bookingApi.applyCoupon({ holdId: params.holdId, code }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["hold", params.holdId] });
    },
  });

  useEffect(() => {
    if (autoApplyRanRef.current) return;
    if (!hold || baseAmount <= 0) return;
    if (serverCouponCode) {
      autoApplyRanRef.current = true;
      // Hold already carries a coupon — surface a label so the DiscountInput
      // collapses to its disabled-pill state.
      if (!discountLabel) {
        setDiscountLabel(`Code: ${serverCouponCode} applied`);
      }
      return;
    }
    if (newUserDiscountQuery.isLoading) return;

    const nuDiscount = newUserDiscountQuery.data?.discount;
    autoApplyRanRef.current = true;

    (async () => {
      if (nuDiscount?.code) {
        try {
          const res = await applyCouponMutation.mutateAsync(nuDiscount.code);
          if (res.success) {
            setNewUserApplied(true);
            const label =
              nuDiscount.type === "PERCENTAGE"
                ? `${nuDiscount.value / 100}% off`
                : formatRupees(nuDiscount.value);
            setDiscountLabel(`New User: ${label}`);
            return;
          }
        } catch {
          // fall through to flat fallback
        }
      }
      try {
        const res = await applyCouponMutation.mutateAsync(FALLBACK_CODE);
        if (res.success) {
          setDiscountLabel("Flat ₹100 OFF applied");
        }
      } catch {
        // fine — no coupon configured, continue at full price.
      }
    })();
  }, [
    hold,
    baseAmount,
    serverCouponCode,
    newUserDiscountQuery.data,
    newUserDiscountQuery.isLoading,
    applyCouponMutation,
    discountLabel,
  ]);

  // ── Manual coupon input (via DiscountInput component) ──────────────────────
  async function handleManualApply(
    code: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await applyCouponMutation.mutateAsync(code);
      if (res.success) {
        setDiscountLabel(
          res.discountAmount
            ? `Code: ${code} — ${formatRupees(res.discountAmount)} off`
            : `Code: ${code} applied`
        );
        return { success: true };
      }
      return { success: false, error: res.error ?? "Invalid code" };
    } catch (err) {
      return {
        success: false,
        error: err instanceof ApiError ? err.message : "Couldn't apply code",
      };
    }
  }

  // ── Countdown ──────────────────────────────────────────────────────────────
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const expiresAt = hold ? new Date(hold.expiresAt).getTime() : 0;
  const msLeft = Math.max(0, expiresAt - now);
  const secsLeft = Math.floor(msLeft / 1000);
  const mm = Math.floor(secsLeft / 60);
  const ss = secsLeft % 60;
  const expiredFired = useRef(false);
  useEffect(() => {
    if (!hold) return;
    if (msLeft > 0) return;
    if (expiredFired.current) return;
    expiredFired.current = true;
    Alert.alert(
      "Slot released",
      "Your hold expired — please pick a time again.",
      [
        {
          text: "OK",
          onPress: () =>
            navigation.dispatch(
              CommonActions.reset({
                index: 0,
                routes: [{ name: "BookSport" }],
              })
            ),
        },
      ]
    );
  }, [hold, msLeft, navigation]);

  // ── Method selection ───────────────────────────────────────────────────────
  // Pick the first enabled tile so the user never lands on a hidden method.
  // `config` always has a value (either fetched or defaults) so we can seed
  // the initial selection synchronously on first render.
  const [method, setMethod] = useState<PaymentMethodType>(() => {
    if (config.onlineEnabled) return "online";
    if (config.upiQrEnabled) return "upi_qr";
    return "cash";
  });

  const [advanceMethod, setAdvanceMethod] =
    useState<AdvancePaymentMethod>("online");

  // UPI QR screen shows inline (same layout as web's `showUpiQr` flag).
  const [showUpiQr, setShowUpiQr] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  // ── Auto-scroll when the advance picker appears ───────────────────────────
  // When the user taps "Pay 50% Now" the AdvancePaymentPicker renders below
  // the Payment Method tiles, but on shorter screens both the picker and the
  // Pay CTA sit below the fold. Capture the picker's Y offset via onLayout,
  // then scroll to it (with a little header padding) as soon as the method
  // flips to "cash". Web doesn't need this because CSS grows the page and
  // the sticky footer stays in view; native must do it manually.
  const scrollRef = useRef<ScrollView | null>(null);
  const advancePickerYRef = useRef<number | null>(null);
  useEffect(() => {
    if (method !== "cash") {
      // Picker is unmounted — forget last offset so the next selection
      // waits for a fresh onLayout (the picker's Y can shift if the
      // tiles above it resize).
      advancePickerYRef.current = null;
      return;
    }
    let cancelled = false;
    const tryScroll = () => {
      if (cancelled) return;
      const y = advancePickerYRef.current;
      if (y == null) {
        // Picker hasn't laid out yet — retry on the next frame.
        requestAnimationFrame(tryScroll);
        return;
      }
      scrollRef.current?.scrollTo({
        y: Math.max(0, y - 12),
        animated: true,
      });
    };
    requestAnimationFrame(tryScroll);
    return () => {
      cancelled = true;
    };
  }, [method]);

  // ── Post-payment nav ───────────────────────────────────────────────────────
  // After a successful payment we want the user on Account → BookingDetail
  // (another tab) and the Book stack wiped so they can't hit Back into the
  // now-consumed hold.
  //
  // Previously this dispatched `CommonActions.navigate({ name: "Main", … })`
  // from the BookStack's navigation prop and then reset Book synchronously.
  // The reset fires before the cross-tab navigate commits, leaving the user
  // on BookSport ("Book a Court"). Pattern used by HomeScreen works:
  //   1. Walk up to the tab navigator via getParent()
  //   2. Call navigate("Account", …) directly — tab nav recognises the
  //      sibling and switches focus immediately
  //   3. Defer the Book stack reset to the next tick so the tab switch has
  //      already committed (and Checkout is no longer the focused screen).
  function goToBookingDetail(bookingId: string) {
    void qc.invalidateQueries({ queryKey: ["bookings"] });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });

    const tabs =
      navigation.getParent<NativeStackNavigationProp<MainTabsParamList>>();

    // Jump to Account → BookingDetail. `initial: false` keeps AccountHome
    // in the stack so BookingDetail renders a back chevron in its header.
    tabs?.navigate("Account", {
      screen: "BookingDetail",
      params: { bookingId },
      initial: false,
    });

    // Defer the Book stack reset until after the cross-tab navigate has
    // committed, otherwise the reset can short-circuit the tab switch and
    // the user ends up on BookSport instead of BookingDetail.
    setTimeout(() => {
      navigation.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{ name: "BookSport" }],
        })
      );
    }, 0);
  }

  // ── Online payment (Razorpay native SDK) ───────────────────────────────────
  // Web supports both PhonePe (redirect-based) and Razorpay (modal) gateways;
  // mobile only ships with the Razorpay native SDK because PhonePe has no
  // React Native SDK and we don't want to punt users to an external browser
  // mid-flow. The PaymentMethodTiles subtitle still reflects the admin's
  // chosen gateway so the tile text matches web exactly.
  async function handleRazorpayPayment(isAdvance: boolean) {
    if (!hold || !signedInUser) return;

    // Server computes the actual order amount (half of overrideAmount when
    // isAdvance=true) and returns it back as order.amount.
    const order = await bookingApi.createOrder({
      holdId: params.holdId,
      isAdvance,
      overrideAmount: effectiveAmount,
    });

    const options: RazorpayOptions = {
      key: order.keyId,
      // Razorpay native SDK expects paise (integer).
      amount: Math.round(order.amount * 100),
      currency: order.currency,
      name: "Momentum Arena",
      description: isAdvance
        ? `Advance for Hold #${params.holdId.slice(-8)}`
        : `Booking Hold #${params.holdId.slice(-8)}`,
      order_id: order.orderId,
      prefill: {
        name: signedInUser.name ?? undefined,
        email: signedInUser.email ?? undefined,
        contact: signedInUser.phone ?? undefined,
      },
      theme: { color: colors.primary },
    };

    let success: PaymentSuccessData;
    try {
      success = (await RazorpayCheckout.open(options)) as PaymentSuccessData;
    } catch (err) {
      const e = err as PaymentErrorData;
      if (e?.code === 2 || e?.description?.toLowerCase().includes("cancel")) {
        return; // user dismissed sheet — not an error worth surfacing.
      }
      throw new ApiError(
        e?.description || "Payment failed. Try another method.",
        0,
        e
      );
    }

    if (
      !success.razorpay_payment_id ||
      !success.razorpay_order_id ||
      !success.razorpay_signature
    ) {
      throw new ApiError(
        "We couldn't confirm the payment. If money was debited we'll reach out.",
        0,
        null
      );
    }

    const verify = await bookingApi.verifyOrder({
      holdId: params.holdId,
      razorpayPaymentId: success.razorpay_payment_id,
      razorpayOrderId: success.razorpay_order_id,
      razorpaySignature: success.razorpay_signature,
      isAdvance,
    });

    if (!verify.success || !verify.bookingId) {
      throw new ApiError("Payment verification failed.", 0, null);
    }

    goToBookingDetail(verify.bookingId);
  }

  async function handleContinue() {
    if (!hold || !signedInUser) return;
    setProcessing(true);
    setPaymentError(null);
    try {
      if (method === "online") {
        await handleRazorpayPayment(false);
      } else if (method === "upi_qr") {
        // Don't commit yet — show the QR, commit after user taps
        // "I've Completed the Payment". Hold stays active until either
        // that commit succeeds or the TTL expires.
        setShowUpiQr(true);
      } else if (method === "cash") {
        if (advanceMethod === "online") {
          await handleRazorpayPayment(true);
        } else {
          // Same UPI-QR flow, but commit flags the booking as 50% advance.
          setShowUpiQr(true);
        }
      }
    } catch (err) {
      setPaymentError(
        err instanceof ApiError
          ? err.message
          : "Payment couldn't complete. Please try again."
      );
    } finally {
      setProcessing(false);
    }
  }

  // ── Loading / error states ─────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Screen>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
          <Text variant="small" color={colors.mutedForeground} style={styles.loadingLabel}>
            Loading your hold…
          </Text>
        </View>
      </Screen>
    );
  }

  if (isError || !hold) {
    return (
      <Screen>
        <View style={styles.centered}>
          <Text variant="heading">Couldn't load this hold</Text>
          <Text
            variant="small"
            color={colors.mutedForeground}
            align="center"
            style={styles.errorBody}
          >
            The slot may have expired. Please pick it again.
          </Text>
          <Button
            label="Back to booking"
            onPress={() =>
              navigation.dispatch(
                CommonActions.reset({
                  index: 0,
                  routes: [{ name: "BookSport" }],
                })
              )
            }
            style={styles.errorCta}
          />
          <Button label="Retry" variant="ghost" onPress={() => refetch()} />
        </View>
      </Screen>
    );
  }

  // ── UPI QR flow (inline, matches web) ──────────────────────────────────────
  if (showUpiQr) {
    const isAdvanceFlow = method === "cash";
    const upiAmount = isAdvanceFlow ? advanceAmount : effectiveAmount;
    return (
      <Screen padded={false}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.header}>
            <Text variant="tiny" color={colors.primary} style={styles.kicker}>
              UPI QR PAYMENT
            </Text>
            <Text variant="title">Scan &amp; pay</Text>
          </View>
          <UpiQrCheckout
            amount={effectiveAmount}
            isAdvance={isAdvanceFlow}
            advanceAmount={isAdvanceFlow ? advanceAmount : undefined}
            onCancel={() => setShowUpiQr(false)}
            onPaymentInitiated={async () => {
              // Commit the booking as PENDING. Admin confirms the UTR via the
              // WhatsApp screenshot separately; the booking appears in "My
              // Bookings" immediately so the user can see it.
              try {
                const res = await bookingApi.selectPayment({
                  holdId: params.holdId,
                  method: isAdvanceFlow ? "CASH" : "UPI_QR",
                  overrideAmount: upiAmount,
                  isAdvance: isAdvanceFlow,
                });
                if (!res.success || !res.bookingId) {
                  return { error: res.error || "Failed to create booking" };
                }
                return { bookingId: res.bookingId };
              } catch (err) {
                return {
                  error:
                    err instanceof ApiError
                      ? err.message
                      : "Failed to create booking",
                };
              }
            }}
            onDone={(bookingId) => goToBookingDetail(bookingId)}
          />
          {isAdvanceFlow ? (
            <Text
              variant="tiny"
              align="center"
              color="#facc15"
              style={styles.advanceNote}
            >
              Paying advance: {formatRupees(advanceAmount)} · Remaining at
              venue: {formatRupees(remainingAmount)}
            </Text>
          ) : null}
        </ScrollView>
      </Screen>
    );
  }

  const sortedSlots = [...hold.slotPrices].sort((a, b) => a.hour - b.hour);
  const discountActive = serverDiscount > 0;
  const applying = applyCouponMutation.isPending;
  const sportKey = hold.courtConfig.sport;

  const { activeGateway: gateway, onlineEnabled, upiQrEnabled, advanceEnabled } =
    config;

  // CTA label matches web: "Pay ₹X" / "Show QR — ₹X" / "Pay Advance ₹Y — Book Now"
  const ctaLabel =
    method === "upi_qr"
      ? `Show QR — ${formatRupees(effectiveAmount)}`
      : method === "cash"
      ? `Pay Advance ${formatRupees(advanceAmount)} — Book Now`
      : `Pay ${formatRupees(effectiveAmount)}`;

  return (
    <Screen padded={false}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll}>
        {/* Page title — matches web's "Complete Payment" (no kicker). */}
        <Text variant="title">Complete Payment</Text>

        {/* Countdown */}
        <View
          style={[
            styles.timer,
            msLeft < 60 * 1000 && styles.timerUrgent,
          ]}
        >
          <AlarmClock
            size={16}
            color={msLeft < 60 * 1000 ? colors.destructive : colors.primary}
          />
          <Text
            variant="small"
            color={msLeft < 60 * 1000 ? colors.destructive : colors.foreground}
          >
            Slot held for{" "}
            <Text
              variant="small"
              weight="700"
              color={msLeft < 60 * 1000 ? colors.destructive : colors.foreground}
            >
              {String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
            </Text>
          </Text>
        </View>

        {/* Booking Summary — exact mirror of web's booking-summary card.
            Reserved yellow pill in the header; KV rows for Sport / Type /
            Date / Slots; per-slot breakdown shown only when >1 slot; Total
            row emerald-green, all inside the same card (no separate totals
            block). */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryHead}>
            <Text variant="bodyStrong">Booking Summary</Text>
            <View style={styles.reservedPill}>
              <Text variant="tiny" weight="600" color={colors.yellow400}>
                Reserved
              </Text>
            </View>
          </View>

          <View style={styles.kvList}>
            <KVRow label="Sport" value={sportLabel(sportKey)} />
            <KVRow
              label="Type"
              value={customerFacingCourtLabel(
                hold.courtConfig.label,
                hold.wasBookedAsHalfCourt
              )}
            />
            <KVRow label="Date" value={formatDateLong(hold.date)} />
            <KVRow
              label="Slots"
              value={formatHoursAsRanges(sortedSlots.map((s) => s.hour))}
            />
          </View>

          <View style={styles.summaryDivider} />

          {sortedSlots.length > 1 ? (
            <View style={styles.breakdown}>
              {sortedSlots.map((slot) => (
                <View key={slot.hour} style={styles.breakdownRow}>
                  <Text variant="small" color={colors.subtleForeground}>
                    {formatHourRangeCompact(slot.hour)}
                  </Text>
                  <Text variant="small" color={colors.zinc300}>
                    {formatRupees(slot.price)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          <View
            style={[
              styles.totalRow,
              sortedSlots.length > 1 && styles.totalRowSeparated,
            ]}
          >
            <Text variant="bodyStrong">Total</Text>
            <Text variant="heading" weight="700" color={colors.emerald400}>
              {formatRupees(effectiveAmount)}
            </Text>
          </View>
        </View>

        {/* New-user discount pill — mirrors web: shown only after the auto-
            apply code path flagged newUserApplied. Regular FLAT100 /
            manual codes stay in the DiscountInput's disabled pill. */}
        {newUserApplied ? (
          <View style={styles.newUserPill}>
            <Sparkles size={16} color={colors.emerald400} />
            <Text variant="small" color={colors.emerald400} style={styles.newUserPillText}>
              {discountLabel} — New total:{" "}
              <Text variant="small" weight="700" color={colors.emerald400}>
                {formatRupees(effectiveAmount)}
              </Text>
            </Text>
          </View>
        ) : null}

        {/* Discount input — only shown when no new-user discount is active.
            The DiscountInput component handles both the input row + the
            "View available coupons" drawer (matches web's component). */}
        {!newUserApplied ? (
          <View style={styles.discountBlock}>
            <Text variant="small" weight="500" color={colors.zinc400}>
              Discount Code
            </Text>
            <DiscountInput
              bookingAmount={baseAmount}
              sport={sportKey}
              disabled={discountActive}
              disabledMessage={discountLabel ?? "Discount applied"}
              onApply={handleManualApply}
            />
          </View>
        ) : null}

        {/* Equipment banner — CRICKET / FOOTBALL match web's zinc-800/60
            rounded banner with emoji + copy. */}
        {sportKey === "CRICKET" ? (
          <View style={styles.equipmentBanner}>
            <Text variant="body">🏏</Text>
            <Text variant="small" color={colors.zinc300} style={styles.equipmentText}>
              Equipment (stumps, bats, and balls) is covered in the pricing.
            </Text>
          </View>
        ) : null}
        {sportKey === "FOOTBALL" ? (
          <View style={styles.equipmentBanner}>
            <Text variant="body">⚽</Text>
            <Text variant="small" color={colors.zinc300} style={styles.equipmentText}>
              Equipment (football and keeping gloves) is covered in the pricing.
            </Text>
          </View>
        ) : null}

        {/* Payment method */}
        <View style={styles.sectionBlock}>
          <Text variant="bodyStrong" style={styles.sectionTitle}>
            Payment Method
          </Text>
          <PaymentMethodTiles
            selected={method}
            onSelect={setMethod}
            gateway={gateway}
            onlineEnabled={onlineEnabled}
            upiQrEnabled={upiQrEnabled}
            advanceEnabled={advanceEnabled}
          />
        </View>

        {/* Advance sub-picker — wrapped in a View so we can capture its Y
            offset on layout and auto-scroll to it when the 50% tile is
            selected (see `advancePickerYRef` effect above). */}
        {method === "cash" ? (
          <View
            onLayout={(e) => {
              advancePickerYRef.current = e.nativeEvent.layout.y;
            }}
          >
            <AdvancePaymentPicker
              totalAmount={effectiveAmount}
              advanceAmount={advanceAmount}
              remainingAmount={remainingAmount}
              selected={advanceMethod}
              onSelect={setAdvanceMethod}
              gateway={gateway}
            />
          </View>
        ) : null}

        {paymentError ? (
          <View style={styles.errorBox}>
            <Text variant="small" align="center" color={colors.destructive}>
              {paymentError}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label={ctaLabel}
          onPress={handleContinue}
          loading={processing || applying}
          disabled={
            msLeft <= 0 || effectiveAmount <= 0 || !signedInUser
          }
          size="lg"
          fullWidth
        />
      </View>
    </Screen>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Mirror of web's `customerFacingCourtLabel` in @/lib/court-config. */
function customerFacingCourtLabel(
  courtConfigLabel: string,
  wasBookedAsHalfCourt: boolean
): string {
  return wasBookedAsHalfCourt ? "Half Court (40×90)" : courtConfigLabel;
}

/** Summary-card key/value row. Left label muted, right value white. */
function KVRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.kvRow}>
      <Text variant="small" color={colors.zinc400}>
        {label}
      </Text>
      <Text variant="small" color={colors.foreground}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["6"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["6"],
    gap: spacing["5"],
  },
  timer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2.5"],
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.primary,
  },
  timerUrgent: {
    backgroundColor: colors.destructiveSoft,
    borderColor: colors.destructive,
  },

  // ── Booking Summary card ────────────────────────────────────────────────
  // Web: rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4
  summaryCard: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["5"],
    gap: spacing["4"],
  },
  summaryHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  reservedPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(234, 179, 8, 0.30)", // yellow-500/30
    backgroundColor: "rgba(234, 179, 8, 0.10)", // yellow-500/10
    paddingHorizontal: spacing["2"],
    paddingVertical: 2,
  },
  kvList: {
    gap: spacing["2"],
  },
  kvRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  summaryDivider: {
    height: 1,
    backgroundColor: colors.zinc800,
  },
  breakdown: {
    gap: spacing["1.5"],
    marginBottom: spacing["2"],
  },
  breakdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  totalRowSeparated: {
    paddingTop: spacing["2"],
    borderTopWidth: 1,
    borderTopColor: colors.zinc800,
  },

  // ── New-user discount pill (emerald) ────────────────────────────────────
  newUserPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.emerald500_20,
    backgroundColor: colors.emerald500_05,
    padding: spacing["3"],
  },
  newUserPillText: {
    flex: 1,
  },

  // ── DiscountInput wrapper ───────────────────────────────────────────────
  discountBlock: {
    gap: spacing["2"],
  },

  // ── Equipment banner (CRICKET / FOOTBALL) ───────────────────────────────
  // Web: rounded-xl bg-zinc-800/60 px-4 py-3 flex items-center gap-2
  equipmentBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    borderRadius: radius.xl,
    backgroundColor: colors.zinc800_50,
    paddingHorizontal: spacing["4"],
    paddingVertical: spacing["3"],
  },
  equipmentText: {
    flex: 1,
  },

  // ── Payment method section ──────────────────────────────────────────────
  sectionBlock: {
    gap: spacing["3"],
  },
  sectionTitle: {
    marginBottom: 0,
  },

  // ── Errors / footer ─────────────────────────────────────────────────────
  errorBox: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.30)",
    backgroundColor: "rgba(239, 68, 68, 0.10)",
    padding: spacing["3"],
  },
  advanceNote: {
    marginTop: spacing["4"],
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing["6"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["5"],
    backgroundColor: colors.background,
    gap: spacing["3"],
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing["3"],
  },
  loadingLabel: {
    marginTop: spacing["2"],
  },
  errorBody: {
    maxWidth: 280,
  },
  errorCta: {
    marginTop: spacing["4"],
  },
  kicker: {
    letterSpacing: 1.5,
    fontWeight: "700",
  },
  header: {
    gap: spacing["1.5"],
  },
});
