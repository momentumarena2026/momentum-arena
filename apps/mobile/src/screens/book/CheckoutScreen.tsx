import { useEffect, useMemo, useRef, useState } from "react";
import {
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
import { Skeleton } from "../../components/ui/Skeleton";
import { DiscountInput } from "../../components/booking/DiscountInput";
import {
  RedeemPoints,
  fireRedeemCompleted,
} from "../../components/booking/RedeemPoints";
import {
  PaymentMethodTiles,
  type AmountMode,
  type PayMethod,
} from "../../components/payment/PaymentMethodTiles";
import { PassCheckoutOption } from "../../components/payment/PassCheckoutOption";
import { UpiQrCheckout } from "../../components/payment/UpiQrCheckout";
import { DqrCheckout } from "../../components/payment/DqrCheckout";
import { colors, radius, spacing } from "../../theme";
import { bookingApi, type PaymentConfig } from "../../lib/booking";
import { rewardsApi } from "../../lib/rewards";
import { ApiError } from "../../lib/api";
import {
  formatDateLong,
  formatHourMinuteCompact,
  formatRupees,
  sportLabel,
} from "../../lib/format";
import { useAuth } from "../../providers/AuthProvider";
import {
  trackCheckoutStarted,
  trackCouponApplied,
  trackCouponFailed,
  trackLockExpired,
  trackNewUserDiscountApplied,
  trackPaymentCancelled,
  trackPaymentCompleted,
  trackPaymentFailed,
  trackPaymentInitiated,
  trackPaymentMethodSelected,
} from "../../lib/analytics";
import type {
  BookStackParamList,
  MainTabsParamList,
} from "../../navigation/types";

type Nav = NativeStackNavigationProp<BookStackParamList, "Checkout">;
type Rt = RouteProp<BookStackParamList, "Checkout">;

// Default fallback when no other discount applies. Pickleball gets a
// sport-specific launch promo (PICKLEBALL25, flat 25%); other sports
// fall through to FLAT100.
//
// Kept in sync MANUALLY with web/lib/auto-apply-promo.ts:getAutoApplyCodeForSport.
// React Native runs its own bundle with no path alias to the web app's
// /lib, and cross-package sharing for one mapping is heavier than this
// deserves. If the mapping ever grows beyond a single conditional,
// promote it to a shared package.
const FALLBACK_CODE = "FLAT100";

// First-ever app-booking auto-discount. The server enforces eligibility:
// this code validates ONLY for a customer's first booking made on the app
// (an App-only coupon with a FIRST_APP_BOOKING condition) and silently
// rejects everyone else — so auto-attempting it is always safe.
//
// Kept in sync MANUALLY with web/lib/auto-apply-promo.ts:APP_FIRST_BOOKING_CODE
// for the same reason as FALLBACK_CODE above (no path alias to the web /lib).
const APP_FIRST_BOOKING_CODE = "APPFIRST";

function fallbackCodeFor(sport: string | null | undefined): string {
  return sport === "PICKLEBALL" ? "PICKLEBALL25" : FALLBACK_CODE;
}

function fallbackLabelFor(sport: string | null | undefined): string {
  return sport === "PICKLEBALL"
    ? "Pickleball Launch: 25% OFF applied"
    : "Flat ₹100 OFF applied";
}

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
  dqrEnabled: false,
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
  const { data: configData, isPending: configPending } = useQuery({
    queryKey: ["payment-config"],
    queryFn: () => bookingApi.paymentConfig(),
    staleTime: 60_000,
    retry: 1,
  });
  const config: PaymentConfig = configData ?? DEFAULT_PAYMENT_CONFIG;

  const baseAmount = hold?.totalAmount ?? 0;
  const sport = hold?.courtConfig.sport;
  const bookingCategory = hold?.courtConfig.category ?? null;

  // Earn-rate for THIS booking's sport. Server pre-gates based on the
  // reward engine state + per-sport enable list, so a `bps` of 0 here
  // means "this booking won't earn anything" and we hide the line
  // below. Cached once per sport — the projected points count is
  // computed locally from the live `payableAmount` so it reacts to
  // coupon / points-redeem / advance toggles without re-fetching.
  const earnRateQuery = useQuery({
    queryKey: ["booking-earn-rate", sport],
    queryFn: () => rewardsApi.bookingEarnRate(sport!),
    enabled: !!sport,
    staleTime: 5 * 60_000,
  });
  const earnRateBookingBps = earnRateQuery.data?.bps ?? 0;

  const serverDiscount = hold?.discountAmount ?? 0;
  const serverCouponCode = hold?.couponCode ?? null;
  const appliedAmount = serverDiscount > 0 ? serverDiscount : 0;
  const effectiveAmount = Math.max(0, baseAmount - appliedAmount);

  // Reward redemption state — driven by the RedeemPoints child. The
  // server keeps the canonical pointsToRedeem on the SlotHold; this
  // local copy is just so we can compute the final payable and pass
  // it to the Razorpay/UPI initiators.
  const [pointsRedeemed, setPointsRedeemed] = useState(0);
  const [pointsRedeemPaiseSaved, setPointsRedeemPaiseSaved] = useState(0);
  const pointsRedeemRupees = Math.floor(pointsRedeemPaiseSaved / 100);

  // ── Rentable equipment ─────────────────────────────────────────────────────
  // Rental gear is now picked on the slot-selection screen and
  // snapshotted onto the hold at lock time (see /api/mobile/booking/
  // lock + components/booking/GearPicker.tsx). Checkout displays it
  // read-only — there's no interactive picker on this screen any more.
  const equipmentSnapshot = hold?.equipmentSelection ?? [];
  const equipmentTotalRupees = hold?.equipmentTotalAmount ?? 0;

  const payableAmount = Math.max(
    0,
    effectiveAmount - pointsRedeemRupees + equipmentTotalRupees,
  );

  // Projected Momentum Points earn on this booking — same bps math
  // the server runs at award time (see lib/rewards/earn.ts
  // `computeEarnPoints`): floor(billRupees × bps / 100). Reactive to
  // Total via payableAmount. Hidden when the engine is disabled for
  // this sport (earnRateBookingBps === 0) or the math floors to zero.
  const projectedEarnPoints = Math.max(
    0,
    Math.floor((payableAmount * earnRateBookingBps) / 10000),
  );

  // Advance is always 50% of the FINAL payable (post-coupon +
  // post-points), ceil-rounded — so the half customers pay now and
  // the remainder collected at the venue both reflect the redemption.
  const advanceAmount = Math.ceil(payableAmount * 0.5);
  const remainingAmount = payableAmount - advanceAmount;

  // ── Auto-apply coupons on mount ────────────────────────────────────────────
  // Mirrors web's CheckoutClient, with the app-only APPFIRST attempt first:
  //   1. Attempt APPFIRST — the server only validates it for a customer's
  //      first-ever app booking and silently rejects everyone else, so the
  //      attempt is always safe. On success → newUserApplied=true → emerald
  //      "Sparkles" pill, and we STOP (no new-user / fallback attempts).
  //   2. Else if the user is a new-user (newUserDiscount query returns one),
  //      apply it → newUserApplied=true → emerald "Sparkles" pill.
  //   3. Else fall back to FLAT100.
  //   4. Else continue at full price.
  const autoApplyRanRef = useRef(false);
  const [newUserApplied, setNewUserApplied] = useState(false);
  const [discountLabel, setDiscountLabel] = useState<string | null>(null);

  const checkoutTrackedRef = useRef(false);
  useEffect(() => {
    if (checkoutTrackedRef.current || !hold) return;
    checkoutTrackedRef.current = true;
    trackCheckoutStarted(params.holdId, hold.totalAmount, hold.courtConfig.sport);
  }, [hold, params.holdId]);

  const newUserDiscountQuery = useQuery({
    queryKey: ["new-user-discount", sport, bookingCategory, baseAmount],
    queryFn: () =>
      bookingApi.newUserDiscount(sport!, baseAmount, bookingCategory),
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
    // A pass offer is the better deal and can't combine with coupons —
    // auto-applying one would null the offer server-side and sabotage the
    // default "Book with my pass" selection. Manual entry stays available.
    if (hold.passOffer) {
      autoApplyRanRef.current = true;
      return;
    }
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
    const autoApplyCodes = newUserDiscountQuery.data?.autoApplyCodes ?? [];
    autoApplyRanRef.current = true;

    (async () => {
      // -1. Admin-flagged auto-apply coupons — HIGHEST priority (an event
      //     promo like the worldcup-final discount outranks the welcome
      //     codes, per product rule). The apply route runs the full
      //     validation (platform, sport, BOOKING_DATE, caps), so an
      //     inapplicable candidate silently falls through to the next.
      for (const code of autoApplyCodes) {
        try {
          const res = await applyCouponMutation.mutateAsync(code);
          if (res.success) {
            setNewUserApplied(true); // reuse the applied-pill presentation
            setDiscountLabel(`${code} applied`);
            trackCouponApplied(code, res.discountAmount ?? 0);
            return;
          }
        } catch {
          // try the next candidate
        }
      }
      // 0. First-ever app booking: attempt APPFIRST. The server validates
      //    eligibility (first app booking only) and silently rejects everyone
      //    else, so attempting it unconditionally is safe. On success, surface
      //    it the same way the new-user discount does (emerald Sparkles pill).
      try {
        const res = await applyCouponMutation.mutateAsync(
          APP_FIRST_BOOKING_CODE,
        );
        if (res.success) {
          setNewUserApplied(true);
          setDiscountLabel("First app booking discount");
          trackCouponApplied(APP_FIRST_BOOKING_CODE, res.discountAmount ?? 0);
          return;
        }
      } catch {
        // not eligible / coupon not configured — fall through to the
        // existing new-user → fallback chain unchanged.
      }
      if (nuDiscount?.code) {
        try {
          const res = await applyCouponMutation.mutateAsync(nuDiscount.code);
          if (res.success) {
            setNewUserApplied(true);
            trackNewUserDiscountApplied(res.discountAmount ?? 0);
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
        const code = fallbackCodeFor(sport);
        const res = await applyCouponMutation.mutateAsync(code);
        if (res.success) {
          setDiscountLabel(fallbackLabelFor(sport));
          trackCouponApplied(code, res.discountAmount ?? 0);
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
        trackCouponApplied(code, res.discountAmount ?? 0);
        return { success: true };
      }
      trackCouponFailed(code, res.error ?? "Invalid code");
      return { success: false, error: res.error ?? "Invalid code" };
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Couldn't apply code";
      trackCouponFailed(code, message);
      return { success: false, error: message };
    }
  }

  // UPI QR screen shows inline (same layout as web's `showUpiQr` flag).
  // Declared above the countdown because the hold-expiry effect reads it.
  const [showUpiQr, setShowUpiQr] = useState(false);

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
    // Never fire while a UPI sheet (DQR or static QR) is up — mirrors web's
    // `{!showUpiQr && <CountdownTimer .../>}`. `/dqr/initiate` extends the
    // hold to 15 min server-side but the cached ['hold'] query still holds
    // the original 5-min `expiresAt`, so the reset below would otherwise
    // unmount the sheet (and its polling + "I've paid" claim button) out
    // from under an in-flight payment.
    if (showUpiQr) return;
    if (msLeft > 0) return;
    if (expiredFired.current) return;
    expiredFired.current = true;
    trackLockExpired(params.holdId);
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
  }, [hold, msLeft, navigation, showUpiQr]);

  // ── Method selection ───────────────────────────────────────────────────────
  // Pick the first enabled tile so the user never lands on a hidden method.
  // `config` always has a value (either fetched or defaults) so we can seed
  // the initial selection synchronously on first render.
  // Two-level: amount mode (full / 50% advance) × method (UPI / gateway).
  // UPI is pre-selected to steer customers off the fee-bearing gateway.
  const [amountMode, setAmountMode] = useState<AmountMode>(() =>
    config.onlineEnabled || config.upiQrEnabled ? "full" : "advance",
  );
  const [method, setMethod] = useState<PayMethod>(() =>
    config.upiQrEnabled ? "upi" : "gateway",
  );

  // Default to "Book with my pass" the moment the hold reveals an
  // eligible pass (server-computed; nulls out when a coupon/points land,
  // in which case fall back off the pass tile).
  const passOffer = hold?.passOffer ?? null;
  useEffect(() => {
    if (passOffer) setAmountMode("pass");
    else
      setAmountMode((m) =>
        m === "pass"
          ? config.onlineEnabled || config.upiQrEnabled
            ? "full"
            : "advance"
          : m,
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!passOffer]);

  // The seeds above run once, and on a cold start they run against
  // DEFAULT_PAYMENT_CONFIG (the ['payment-config'] query isn't persisted, so
  // a fresh launch has an empty cache). Re-sync once the real config lands:
  // with only one method enabled PaymentMethodTiles hides the method toggle
  // entirely, so a stale "upi" seed would strand the customer on a rail the
  // admin switched off with no way to move. Only invalid selections are
  // rewritten, so a deliberate user choice is never clobbered on refetch.
  useEffect(() => {
    if (!configData) return;
    setMethod((m) => {
      if (m === "upi" && !configData.upiQrEnabled && configData.onlineEnabled) {
        return "gateway";
      }
      if (m === "gateway" && !configData.onlineEnabled && configData.upiQrEnabled) {
        return "upi";
      }
      return m;
    });
    setAmountMode((a) => {
      const fullEnabled = configData.onlineEnabled || configData.upiQrEnabled;
      if (a === "full" && !fullEnabled && configData.advanceEnabled) {
        return "advance";
      }
      if (a === "advance" && !configData.advanceEnabled && fullEnabled) {
        return "full";
      }
      return a;
    });
  }, [configData]);

  // Hard cap on how long the Pay button waits for that config. lib/api sets no
  // request timeout, so `retry: 1` doesn't bound a hanging endpoint and the CTA
  // would spin forever — the exact opposite of the "never blocked on this call"
  // intent above. Past the cap we commit to DEFAULT_PAYMENT_CONFIG; if the real
  // config lands later the re-sync effect still corrects an invalid method.
  const [configWaitElapsed, setConfigWaitElapsed] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setConfigWaitElapsed(true), 6000);
    return () => clearTimeout(id);
  }, []);
  const configGating = configPending && !configWaitElapsed;

  const [processing, setProcessing] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  // The method toggle now renders inline inside the selected amount card
  // (PaymentMethodTiles), so the old auto-scroll-to-advance-picker dance is
  // no longer needed — the ScrollView ref is kept for general use.
  const scrollRef = useRef<ScrollView | null>(null);

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
      overrideAmount: payableAmount,
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

    trackPaymentInitiated("RAZORPAY", order.amount, params.holdId);

    // Webhook escape hatch. The payment.captured webhook completes the
    // booking server-side independently of this screen — and the SDK's
    // sheet has been seen hanging on the test bank page while exactly
    // that happened (2026-07-14: "order completes but stuck on the same
    // page"). So EVERY exit from the sheet — cancel, error, or a failed
    // verify — first asks the server whether the money already landed;
    // if it did, this was a success regardless of what the SDK said.
    const settledByWebhook = async (): Promise<string | null> => {
      try {
        const s = await bookingApi.orderStatus(order.orderId);
        return s.completed && s.bookingId ? s.bookingId : null;
      } catch {
        return null;
      }
    };
    const finishAsPaid = (bookingId: string) => {
      trackPaymentCompleted("RAZORPAY", order.amount, bookingId);
      fireRedeemCompleted(pointsRedeemed, pointsRedeemPaiseSaved);
      goToBookingDetail(bookingId);
    };

    let success: PaymentSuccessData;
    try {
      // Breadcrumbs around the SDK promise — pin down whether it
      // resolved, rejected, or hung on the next repro.
      console.log("[razorpay] opening sheet", {
        order: options.order_id,
        amount: options.amount,
      });
      success = (await RazorpayCheckout.open(options)) as PaymentSuccessData;
      console.log("[razorpay] sheet resolved", {
        paymentId: success?.razorpay_payment_id,
      });
    } catch (err) {
      const e = err as PaymentErrorData;
      console.log("[razorpay] sheet rejected", {
        code: e?.code,
        description: e?.description?.slice(0, 200),
      });
      // The "Back" press that escapes a stuck bank page surfaces here
      // as a cancel — but the webhook may have already completed the
      // booking. Check before treating any rejection as a failure.
      const paidBookingId = await settledByWebhook();
      if (paidBookingId) {
        finishAsPaid(paidBookingId);
        return;
      }
      if (e?.code === 2 || e?.description?.toLowerCase().includes("cancel")) {
        trackPaymentCancelled("RAZORPAY", params.holdId);
        return; // user dismissed sheet — not an error worth surfacing.
      }
      // Surface the SDK's own reason (incl. its numeric code) so a
      // failed test/live payment reads as an actionable error on the
      // checkout screen instead of a silent dead end.
      throw new ApiError(
        e?.description
          ? `Payment failed: ${e.description}`
          : `Payment failed (code ${e?.code ?? "?"}). Try another method.`,
        0,
        e
      );
    }

    if (
      !success.razorpay_payment_id ||
      !success.razorpay_order_id ||
      !success.razorpay_signature
    ) {
      const paidBookingId = await settledByWebhook();
      if (paidBookingId) {
        finishAsPaid(paidBookingId);
        return;
      }
      throw new ApiError(
        "We couldn't confirm the payment. If money was debited we'll reach out.",
        0,
        null
      );
    }

    let verified: { success: boolean; bookingId?: string };
    try {
      verified = await bookingApi.verifyOrder({
        holdId: params.holdId,
        razorpayPaymentId: success.razorpay_payment_id,
        razorpayOrderId: success.razorpay_order_id,
        razorpaySignature: success.razorpay_signature,
        isAdvance,
      });
    } catch (err) {
      // Verify request failed/timed out — the webhook may still have
      // (or shortly will have) landed the booking. Prefer that truth
      // over an error the customer would misread as "payment failed".
      const paidBookingId = await settledByWebhook();
      if (paidBookingId) {
        finishAsPaid(paidBookingId);
        return;
      }
      throw err;
    }

    if (!verified.success || !verified.bookingId) {
      const paidBookingId = await settledByWebhook();
      if (paidBookingId) {
        finishAsPaid(paidBookingId);
        return;
      }
      throw new ApiError("Payment verification failed.", 0, null);
    }

    finishAsPaid(verified.bookingId);
  }

  async function handleContinue() {
    if (!hold || !signedInUser) return;
    setProcessing(true);
    setPaymentError(null);
    try {
      if (method === "gateway") {
        await handleRazorpayPayment(amountMode === "advance");
      } else {
        // UPI — show the QR (DQR auto-confirm if enabled, else static).
        // Hold stays active until the booking is created or the TTL expires.
        setShowUpiQr(true);
      }
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : "Payment couldn't complete. Please try again.";
      trackPaymentFailed("RAZORPAY", params.holdId, message);
      setPaymentError(message);
    } finally {
      setProcessing(false);
    }
  }

  // ── Loading / error states ─────────────────────────────────────────────────
  if (isLoading) {
    // Skeleton mirrors the live checkout layout (Booking Summary card
    // → discount input → payment tiles → Pay button) so the page
    // doesn't jump when data lands. Replaces the previous centered
    // spinner that gave the user nothing to anchor on.
    return (
      <Screen edges={[]}>
        <View style={styles.loadingScroll}>
          <Skeleton width="40%" height={22} rounded="md" />
          <Skeleton width="70%" height={12} rounded="md" style={styles.loadingSub} />

          {/* Booking Summary card */}
          <View style={styles.loadingCard}>
            <View style={styles.loadingCardHead}>
              <Skeleton width={140} height={18} rounded="md" />
              <Skeleton width={70} height={20} rounded="full" />
            </View>
            {Array.from({ length: 4 }).map((_, i) => (
              <View key={`kv-${i}`} style={styles.loadingKv}>
                <Skeleton width="30%" height={12} rounded="sm" />
                <Skeleton width="40%" height={12} rounded="sm" />
              </View>
            ))}
            <View style={styles.loadingTotal}>
              <Skeleton width={50} height={16} rounded="md" />
              <Skeleton width={80} height={20} rounded="md" />
            </View>
          </View>

          {/* Discount input */}
          <Skeleton width="100%" height={44} rounded="lg" />

          {/* Payment method tiles */}
          <View style={styles.loadingPayTiles}>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={`pm-${i}`} width="100%" height={72} rounded="lg" />
            ))}
          </View>

          {/* Pay button */}
          <Skeleton width="100%" height={48} rounded="xl" />
        </View>
      </Screen>
    );
  }

  if (isError || !hold) {
    return (
      <Screen edges={[]}>
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

  // Bowling-machine holds carry per-slot start minutes (0 or 30) parallel to
  // `hours` / `slotPrices`; hourly holds send an empty array. An empty array
  // is the same discriminator lib/slot-hold.ts uses for "hour-granular hold".
  const slotDurationMinutes = (hold.startMinutes?.length ?? 0) > 0 ? 30 : 60;
  const sortedSlots = hold.slotPrices
    .map((s, i) => ({ ...s, minute: hold.startMinutes?.[i] ?? 0 }))
    .sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
  const discountActive = serverDiscount > 0;
  const applying = applyCouponMutation.isPending;
  const sportKey = hold.courtConfig.sport;

  const { activeGateway: gateway, onlineEnabled, upiQrEnabled, advanceEnabled } =
    config;

  // Degenerate config: "advance" is only a 50% split of the SAME two rails,
  // not a rail of its own, so with both online + UPI QR off there is nothing
  // to charge with regardless of advanceEnabled. The method re-sync effect
  // above can't correct for this (there is no valid method to move to), so
  // say it plainly instead of rendering a Pay button that cannot work.
  const noPaymentRail = !onlineEnabled && !upiQrEnabled;

  // CTA label matches web's two-level wording.
  const ctaLabel =
    method === "gateway"
      ? amountMode === "advance"
        ? `Pay Advance ${formatRupees(advanceAmount)}`
        : `Pay ${formatRupees(payableAmount)}`
      : amountMode === "advance"
      ? `Pay Advance ${formatRupees(advanceAmount)} via UPI`
      : `Pay ${formatRupees(payableAmount)} via UPI`;

  return (
    <Screen padded={false} edges={[]}>
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
              value={formatSlotsAsRanges(sortedSlots, slotDurationMinutes)}
            />
          </View>

          <View style={styles.summaryDivider} />

          {sortedSlots.length > 1 ? (
            <View style={styles.breakdown}>
              {sortedSlots.map((slot) => (
                <View
                  key={`${slot.hour}:${slot.minute}`}
                  style={styles.breakdownRow}
                >
                  <Text variant="small" color={colors.subtleForeground}>
                    {formatSlotsAsRanges([slot], slotDurationMinutes)}
                  </Text>
                  <Text variant="small" color={colors.zinc300}>
                    {formatRupees(slot.price)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {pointsRedeemRupees > 0 ? (
            <View style={styles.breakdownRow}>
              <Text variant="small" color={colors.emerald400}>
                {pointsRedeemed.toLocaleString("en-IN")} pts applied
              </Text>
              <Text variant="small" color={colors.emerald400}>
                -{formatRupees(pointsRedeemRupees)}
              </Text>
            </View>
          ) : null}

          {equipmentTotalRupees > 0 ? (
            <View style={styles.breakdownRow}>
              <Text
                variant="small"
                color={colors.zinc300}
                style={{ flex: 1, marginRight: 8 }}
                numberOfLines={1}
              >
                Gear ({equipmentSnapshot.length} item
                {equipmentSnapshot.length === 1 ? "" : "s"})
                {equipmentSnapshot.length > 0 ? (
                  <Text variant="small" color={colors.zinc500}>
                    {" · "}
                    {equipmentSnapshot.map((e) => e.name).join(", ")}
                  </Text>
                ) : null}
              </Text>
              <Text variant="small" color={colors.zinc300}>
                +{formatRupees(equipmentTotalRupees)}
              </Text>
            </View>
          ) : null}

          <View
            style={[
              styles.totalRow,
              (sortedSlots.length > 1 ||
                pointsRedeemRupees > 0 ||
                equipmentTotalRupees > 0) &&
                styles.totalRowSeparated,
            ]}
          >
            <Text variant="bodyStrong">Total</Text>
            <Text variant="heading" weight="700" color={colors.emerald400}>
              {formatRupees(payableAmount)}
            </Text>
          </View>

          {/* Earn preview — same bps math the server runs at award time
              (lib/rewards/earn.ts). Hides when the engine is off, the
              sport doesn't earn (server-gated via the bookingEarnRate
              endpoint), or floors to zero. Reactive to the live
              payableAmount so the count ticks down if the user
              redeems points / applies a coupon. */}
          {projectedEarnPoints > 0 ? (
            <View style={styles.earnPreviewRow}>
              <Sparkles size={12} color={colors.emerald400} />
              <Text variant="tiny" color={colors.emerald400}>
                You&apos;ll earn{" "}
                <Text variant="tiny" weight="700" color={colors.emerald400}>
                  {projectedEarnPoints.toLocaleString("en-IN")}
                </Text>{" "}
                Momentum {projectedEarnPoints === 1 ? "Point" : "Points"}
              </Text>
            </View>
          ) : null}
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

        {/* Momentum Points redemption — auto-hides when disabled / no
            balance / cap below min. `nonce` = serverDiscount keeps the
            preview in sync whenever a coupon changes (apply/clear), so
            the cap recomputes off the post-coupon bill. The hold's
            redemption columns are server-cleared on coupon mutations
            via the apply-coupon route, so both sides stay aligned. */}
        <RedeemPoints
          holdId={params.holdId}
          billRupees={effectiveAmount}
          nonce={serverDiscount}
          onChange={({ points, paiseSaved }) => {
            setPointsRedeemed(points);
            setPointsRedeemPaiseSaved(paiseSaved);
          }}
        />

        {/* Included Equipment banner — shown only when no rental gear
            was added to this booking. Reassures cricket / football
            customers that the basics are covered. The slot-selection
            page is where rentals get added now (see GearPicker). */}
        {sportKey === "CRICKET" && equipmentTotalRupees === 0 ? (
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

        {/* Old interactive "Rent gear" card has moved upstream to the
            slot-selection screen. The Booking Summary breakdown above
            shows the locked picks read-only; if the customer wants to
            change rentals they tap Back to the slot picker. */}

        {/* Payment method — hidden under noPaymentRail. The tiles gate the
            advance card on advanceEnabled alone, so it would still render a
            selectable "Pay 50% Now" radio for a split of two rails that are
            both off, directly above the footer saying payment is unavailable. */}
        {noPaymentRail ? null : (
          <View style={styles.sectionBlock}>
            <Text variant="bodyStrong" style={styles.sectionTitle}>
              Payment Method
            </Text>
            <PaymentMethodTiles
              amountMode={amountMode}
              onAmountModeChange={(m) => {
                setAmountMode(m);
                trackPaymentMethodSelected(`${m}_${method}`);
                if (hold?.id) {
                  bookingApi
                    .logPaymentMethod({ holdId: hold.id, paymentMethod: `${m}_${method}` })
                    .catch(() => {});
                }
              }}
              method={method}
              onMethodChange={(m) => {
                setMethod(m);
                trackPaymentMethodSelected(`${amountMode}_${m}`);
                if (hold?.id) {
                  bookingApi
                    .logPaymentMethod({ holdId: hold.id, paymentMethod: `${amountMode}_${m}` })
                    .catch(() => {});
                }
              }}
              gateway={gateway}
              fullAmount={payableAmount}
              advanceAmount={advanceAmount}
              remainingAmount={remainingAmount}
              onlineEnabled={onlineEnabled}
              upiQrEnabled={upiQrEnabled}
              advanceEnabled={advanceEnabled}
              passAvailable={!!passOffer && !!signedInUser}
              passDesc={
                passOffer
                  ? passOffer.fullCoverage
                    ? "Pay ₹0 — fully covered by your pass"
                    : `Pass + pay ${formatRupees(passOffer.remainderAmount)}`
                  : undefined
              }
            />

            {/* Pass confirm — replaces the footer pay button while
                "Book with my pass" is selected. */}
            {amountMode === "pass" && passOffer && signedInUser ? (
              <PassCheckoutOption
                holdId={hold.id}
                offer={passOffer}
                prefill={{
                  name: signedInUser.name,
                  email: signedInUser.email,
                  phone: signedInUser.phone,
                }}
                onBooked={goToBookingDetail}
              />
            ) : null}
          </View>
        )}

        {paymentError ? (
          <View style={styles.errorBox}>
            <Text variant="small" align="center" color={colors.destructive}>
              {paymentError}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {amountMode === "pass" && passOffer ? (
          <Text variant="tiny" align="center" color={colors.zinc500}>
            Booking with your pass — confirm above. Passes can't be combined
            with coupons or points.
          </Text>
        ) : noPaymentRail ? (
          <Text variant="small" align="center" color={colors.mutedForeground}>
            Online payments are temporarily unavailable. Your slot is still
            held — please contact the venue to complete this booking.
          </Text>
        ) : (
          <>
            <Button
              label={ctaLabel}
              onPress={handleContinue}
              // The config wait rides `loading` rather than `disabled` so the
              // button spins instead of sitting greyed-out and dead-looking:
              // a fast tap still can't commit to the seeded method before we
              // know which rails the admin actually left on.
              loading={processing || applying || configGating}
              disabled={msLeft <= 0 || payableAmount <= 0 || !signedInUser}
              size="lg"
              fullWidth
            />
            {configGating ? (
              <Text variant="tiny" align="center" color={colors.zinc500}>
                Checking payment options…
              </Text>
            ) : null}
          </>
        )}
      </View>

      {/* DQR: auto-confirming UPI checkout in a Razorpay-style bottom sheet.
          Rendered as a Modal overlay so this screen stays mounted (and the
          hold countdown keeps ticking) behind the dimmed backdrop. Booking
          is created server-side on payment; onConfirmed jumps straight to
          the booking detail. */}
      {showUpiQr && config.dqrEnabled ? (
        <DqrCheckout
          holdId={params.holdId}
          amount={amountMode === "advance" ? advanceAmount : payableAmount}
          overrideAmount={payableAmount}
          isAdvance={amountMode === "advance"}
          advanceAmount={amountMode === "advance" ? advanceAmount : undefined}
          remainingAmount={
            amountMode === "advance" ? remainingAmount : undefined
          }
          onCancel={() => setShowUpiQr(false)}
          onConfirmed={(bookingId) => {
            setShowUpiQr(false);
            fireRedeemCompleted(pointsRedeemed, pointsRedeemPaiseSaved);
            // Navigating while the native Modal is still dismissing gets
            // swallowed on iOS — let the dismissal finish first.
            setTimeout(() => goToBookingDetail(bookingId), 400);
          }}
        />
      ) : null}

      {/* Legacy static UPI QR (DQR off): same Razorpay-style bottom-sheet
          Modal, but the booking is committed as PENDING on "I've completed
          the payment" and verified manually via the WhatsApp screenshot. */}
      {showUpiQr && !config.dqrEnabled ? (
        <UpiQrCheckout
          amount={payableAmount}
          isAdvance={amountMode === "advance"}
          advanceAmount={amountMode === "advance" ? advanceAmount : undefined}
          remainingAmount={
            amountMode === "advance" ? remainingAmount : undefined
          }
          onCancel={() => setShowUpiQr(false)}
          onPaymentInitiated={async () => {
            // Commit the booking as PENDING. Admin confirms the UTR via the
            // WhatsApp screenshot separately; the booking appears in "My
            // Bookings" immediately so the user can see it.
            const isAdvanceFlow = amountMode === "advance";
            try {
              const res = await bookingApi.selectPayment({
                holdId: params.holdId,
                method: isAdvanceFlow ? "CASH" : "UPI_QR",
                overrideAmount: isAdvanceFlow ? advanceAmount : payableAmount,
                isAdvance: isAdvanceFlow,
              });
              if (!res.success || !res.bookingId) {
                return { error: res.error || "Failed to create booking" };
              }
              fireRedeemCompleted(pointsRedeemed, pointsRedeemPaiseSaved);
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
          onDone={(bookingId) => {
            setShowUpiQr(false);
            // Navigating while the native Modal is still dismissing gets
            // swallowed on iOS — let the dismissal finish first.
            setTimeout(() => goToBookingDetail(bookingId), 400);
          }}
        />
      ) : null}
    </Screen>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Mirror of web's `formatSlotsAsRanges` in @/lib/court-config. Unlike
 * `formatHoursAsRanges` it respects the slot's start minute, so a
 * bowling-machine 6:30-7:00 pick reads as "6:30pm - 7pm" instead of being
 * rounded down to the whole hour. Consecutive slots merge into one range.
 *
 * Local to this screen rather than in lib/format.ts because React Native has
 * no path alias to the web /lib and the mobile formatter is hour-only — same
 * reasoning as FALLBACK_CODE above.
 */
function formatSlotsAsRanges(
  slots: { hour: number; minute: number }[],
  durationMinutes: number
): string {
  if (slots.length === 0) return "";
  const ranges: [number, number][] = slots
    .map((s) => {
      const start = s.hour * 60 + s.minute;
      return [start, start + durationMinutes] as [number, number];
    })
    .sort((a, b) => a[0] - b[0]);

  const merged: [number, number][] = [];
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1];
    if (last && last[1] === start) {
      last[1] = end;
    } else {
      merged.push([start, end]);
    }
  }
  return merged
    .map(([s, e]) => `${formatHourMinuteCompact(s)} - ${formatHourMinuteCompact(e)}`)
    .join(", ");
}

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
  // Emerald earn-preview row — sits right below Total inside the
  // Booking Summary tile.
  earnPreviewRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
    marginTop: 4,
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

  // ── Rentable equipment list (bowling-machine) ───────────────────────────
  equipmentBlock: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["4"],
    gap: spacing["2"],
  },
  equipmentHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  equipmentList: {
    gap: spacing["1.5"],
  },
  equipmentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2.5"],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  equipmentRowChecked: {
    backgroundColor: colors.emerald500_05,
    borderColor: colors.emerald500_30,
  },
  equipmentRowUnchecked: {
    backgroundColor: colors.background,
    borderColor: colors.zinc800,
  },
  equipmentName: {
    flex: 1,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.zinc600,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: colors.emerald500,
    borderColor: colors.emerald500,
  },
  equipmentTotal: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: radius.md,
    backgroundColor: colors.emerald500_05,
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2"],
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
  // Symmetric 12/12 vertical padding. The old 20 bottom + the Screen's
  // (since-removed) bottom safe-area edge stacked ~54dp of dead space
  // under the pay button while only ~12 sat above it — the button read
  // as floating high in an oversized bar (Trello 2026-07-14).
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing["6"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["3"],
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
  // Skeleton container — mirrors the screen padding the real
  // ScrollView uses so the placeholders line up exactly with where
  // their real counterparts will render.
  loadingScroll: {
    paddingHorizontal: spacing["6"],
    paddingTop: spacing["4"],
    paddingBottom: spacing["8"],
    gap: spacing["4"],
  },
  loadingSub: {
    marginTop: spacing["1"],
  },
  loadingCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["4"],
    gap: spacing["3"],
  },
  loadingCardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  loadingKv: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  loadingTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.zinc800,
    paddingTop: spacing["3"],
  },
  loadingPayTiles: {
    gap: spacing["2"],
  },
  errorBody: {
    maxWidth: 280,
  },
  errorCta: {
    marginTop: spacing["4"],
  },
});
