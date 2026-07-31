"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { CountdownTimer } from "@/components/booking/countdown-timer";
import { PaymentSelector, type AmountMode, type PayMethod } from "@/components/payment/payment-selector";
import { PassCheckoutOption, type PassCheckoutOffer } from "@/components/payment/pass-checkout-option";
import { DiscountInput } from "@/components/booking/discount-input";
import { UpiQrCheckout } from "@/components/payment/upi-qr-checkout";
import { DqrCheckout } from "@/components/payment/dqr-checkout";
import { formatPrice } from "@/lib/pricing";
import { validateCoupon } from "@/actions/coupon-validation";
import { getAutoApplyCodeForSport } from "@/lib/auto-apply-promo";
import {
  selectCashPayment,
  selectUpiPayment,
  applyCouponToHold,
  clearCouponFromHold,
  logPaymentMethodSelected,
} from "@/actions/booking";
// UTR submission disabled — admin verifies via WhatsApp screenshot
import { createRecurringBooking } from "@/actions/recurring-booking";
import { Loader2, Sparkles, RefreshCw, Calendar, CheckCircle } from "lucide-react";
import {
  trackCheckoutStarted,
  trackPaymentMethodSelected,
  trackPaymentInitiated,
  trackPaymentCompleted,
  trackPaymentFailed,
  trackPaymentCancelled,
  trackCouponApplied,
  trackNewUserDiscountApplied,
  trackLockExpired,
} from "@/lib/analytics";

interface CheckoutClientProps {
  holdId: string;
  amount: number;
  /** Eligible pass for this hold — renders "Book with my pass" as the
   *  first (and default-selected) payment option. */
  passOffer?: PassCheckoutOffer | null;
  perSessionAmount?: number;
  recurringDiscountPercent?: number;
  sport?: string;
  expiresAt: string;
  userName: string;
  userEmail: string;
  userPhone: string;
  razorpayOfferId?: string;
  /** Admin-flagged auto-apply coupon codes (newest first) — tried
   *  BEFORE the new-user / sport fallback codes. */
  autoApplyCodes?: string[];
  newUserDiscount?: {
    code: string;
    discountAmount: number;
    label: string;
  };
  // Equipment info
  bookingDate?: string;
  startHour?: number;
  endHour?: number;
  // Recurring booking info
  recurringEnabled?: boolean;
  recurringMode?: "weekly" | "daily";
  recurringWeeksCount?: number;
  recurringDaysCount?: number;
  recurringDayOfWeek?: number;
  recurringStartDate?: string;
  recurringStartHour?: number;
  recurringEndHour?: number;
  recurringCourtConfigId?: string;
  gateway: "PHONEPE" | "RAZORPAY";
  onlineEnabled?: boolean;
  upiQrEnabled?: boolean;
  advanceEnabled?: boolean;
  /** When true, "Pay by UPI" uses PhonePe Dynamic QR (auto-confirm);
   *  otherwise it falls back to the static QR + manual-verify flow. */
  dqrEnabled?: boolean;
  /** Rental gear total in rupees, locked from the slot-selection
   *  page. Added straight into the payable; checkout-client no
   *  longer renders an interactive picker — see the Booking Summary
   *  tile in page.tsx for the read-only per-item breakdown. */
  lockedEquipmentTotalRupees?: number;
  /** Number of BookingSlot rows on the hold. Kept on the props
   *  surface for future rental-related callers; current checkout
   *  no longer uses it directly. */
  slotCount?: number;
}

export function CheckoutClient({
  holdId,
  amount,
  passOffer = null,
  perSessionAmount,
  recurringDiscountPercent,
  sport,
  expiresAt,
  userName,
  userEmail,
  userPhone,
  razorpayOfferId,
  autoApplyCodes,
  newUserDiscount,
  bookingDate,
  startHour,
  endHour,
  recurringEnabled,
  recurringMode = "weekly",
  recurringWeeksCount,
  recurringDaysCount,
  recurringDayOfWeek,
  recurringStartDate,
  recurringStartHour,
  recurringEndHour,
  recurringCourtConfigId,
  gateway,
  onlineEnabled = true,
  upiQrEnabled = true,
  advanceEnabled = true,
  dqrEnabled = false,
  lockedEquipmentTotalRupees = 0,
}: CheckoutClientProps) {
  const router = useRouter();
  // Two-level selection: amount mode (full / 50% advance) × method
  // (UPI / gateway). UPI is pre-selected to steer customers away from
  // the fee-bearing gateway. Fall back sensibly when a method/mode is
  // disabled by admin.
  const [amountMode, setAmountMode] = useState<AmountMode>(
    passOffer ? "pass" : onlineEnabled || upiQrEnabled ? "full" : "advance",
  );
  const [method, setMethod] = useState<PayMethod>(
    upiQrEnabled ? "upi" : "gateway",
  );
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUpiQr, setShowUpiQr] = useState(false);

  // Discount state — `effectiveAmount` is the post-coupon total (in rupees),
  // i.e. the bill the points-redemption cap is computed against. The
  // user's final payable is `effectiveAmount - pointsRedeemRupees`.
  const [effectiveAmount, setEffectiveAmount] = useState(amount);
  const [discountApplied, setDiscountApplied] = useState(false);
  const [discountLabel, setDiscountLabel] = useState<string | null>(null);
  const [newUserApplied, setNewUserApplied] = useState(false);
  // Gate: the new-user + fallback effects wait until the admin
  // auto-apply pass has finished (applied one or exhausted the list).
  const [autoCouponTried, setAutoCouponTried] = useState(false);

  // Reward redemption state — fed by the SummaryFooter client
  // island in page.tsx, which now owns the checkbox UI inside the
  // Booking Summary tile. SummaryFooter dispatches a
  // `checkout:redemption-changed` window event whenever the pick
  // toggles; we listen below and mirror its values into local
  // state so the gateway initiation calls + the redemption-applied
  // pill stay in sync. The server still owns the canonical
  // pointsToRedeem on the SlotHold (applyPointsRedemptionToHold /
  // clearPointsRedemptionFromHold are called inside RedeemSlider).
  const [pointsRedeemed, setPointsRedeemed] = useState(0);
  const [pointsRedeemPaiseSaved, setPointsRedeemPaiseSaved] = useState(0);

  useEffect(() => {
    function onRedemptionChanged(e: Event) {
      const detail = (
        e as CustomEvent<{ points: number; paiseSaved: number }>
      ).detail;
      setPointsRedeemed(detail.points);
      setPointsRedeemPaiseSaved(detail.paiseSaved);
    }
    window.addEventListener(
      "checkout:redemption-changed",
      onRedemptionChanged,
    );
    return () =>
      window.removeEventListener(
        "checkout:redemption-changed",
        onRedemptionChanged,
      );
  }, []);

  // Mirror the post-coupon base into the Booking Summary tile. SummaryFooter
  // renders the summary Total but lives across a server boundary (page.tsx),
  // so we sync via a window event — the reverse of redemption-changed which
  // it sends us. Without this, a coupon applied here updates the Pay button
  // but the summary Total still shows the pre-coupon amount. Skip the first
  // run so the SSR preDiscountTotal (already correct, and lower than `amount`
  // when a sport promo is predicted) isn't briefly overwritten before the
  // auto-promo applies.
  const discountSyncMounted = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!discountSyncMounted.current) {
      discountSyncMounted.current = true;
      return;
    }
    window.dispatchEvent(
      new CustomEvent("checkout:discount-changed", {
        detail: { effectiveAmount },
      }),
    );
  }, [effectiveAmount]);

  // Bumped whenever the coupon mutates so the slider re-fetches the
  // preview (and resets to 0). applyCouponToHold / clearCouponFromHold
  // already null out the redemption columns server-side; bumping the
  // nonce keeps the UI in lockstep.
  const [billNonce, setBillNonce] = useState(0);
  // Bumped by the reseed effect below to re-run the admin auto-apply
  // chain against a new base (Book-via tab switches).
  const [autoRetryNonce, setAutoRetryNonce] = useState(0);

  // A "Book via" tab switch flips `amount` between the full total and
  // the pass remainder, and the server clears coupon/points in the same
  // stroke. router.refresh() keeps this island mounted, so everything
  // derived from the old amount is stale when the new prop lands —
  // re-seed it all and let the auto-apply pass re-run on the new base.
  const amountSeedRef = useRef(amount);
  useEffect(() => {
    if (amountSeedRef.current === amount) return;
    amountSeedRef.current = amount;
    // Skip the dispatch this reseed provokes: the SSR preDiscountTotal
    // SummaryFooter just re-seeded from already predicts the promo, and
    // broadcasting the raw base would clobber it until auto-apply lands.
    setEffectiveAmount((prev) => {
      if (prev !== amount) discountSyncMounted.current = false;
      return amount;
    });
    setDiscountApplied(false);
    setDiscountLabel(null);
    setNewUserApplied(false);
    setAutoCouponTried(false);
    setPointsRedeemed(0);
    setPointsRedeemPaiseSaved(0);
    setBillNonce((n) => n + 1);
    // Retrigger the admin auto-apply pass on the NEXT render, after the
    // resets above have landed — keying that effect on `amount` directly
    // would run it in THIS commit where its discountApplied guard still
    // sees the pre-switch value.
    setAutoRetryNonce((n) => n + 1);
  }, [amount]);

  const pointsRedeemRupees = Math.floor(pointsRedeemPaiseSaved / 100);

  // Rental gear is now locked at slot-selection time and snapshotted
  // onto the hold (see /api/booking/lock + components/booking/
  // gear-picker.tsx). Checkout reads the resulting total directly
  // and adds it to the payable — no interactive picker here any more.
  // The Booking Summary tile in page.tsx renders the per-item lines.
  const equipmentTotalRupees = lockedEquipmentTotalRupees;

  // Final payable = slot total - all discounts + equipment rentals.
  // Same convention used by createBookingFromHold so the gateway
  // amount and the booking row line up exactly.
  const payableAmount = Math.max(
    0,
    effectiveAmount - pointsRedeemRupees + equipmentTotalRupees,
  );

  // Recurring confirmation state
  const [recurringResult, setRecurringResult] = useState<{ created: boolean; bookingsCreated?: number; id?: string } | null>(null);

  // Track whether payment was completed (don't release hold if payment succeeded)
  const paymentCompletedRef = useRef(false);

  // Track checkout started on mount
  useEffect(() => {
    trackCheckoutStarted(holdId, amount, sport);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Release hold when user leaves checkout without paying
  const releaseLock = useCallback(() => {
    if (paymentCompletedRef.current) return;
    // Use sendBeacon for reliability — works even during page unload
    const payload = JSON.stringify({ holdId });
    navigator.sendBeacon("/api/booking/release-lock", payload);
  }, [holdId]);

  useEffect(() => {
    // Release hold on browser close / tab close / navigation away.
    // Use both `beforeunload` (desktop) and `pagehide` (mobile Safari/iOS — more reliable).
    window.addEventListener("beforeunload", releaseLock);
    window.addEventListener("pagehide", releaseLock);
    return () => {
      window.removeEventListener("beforeunload", releaseLock);
      window.removeEventListener("pagehide", releaseLock);
      // Also release on React unmount (in-app navigation like back button)
      releaseLock();
    };
  }, [releaseLock]);

  // Derived recurring values
  const recurringCount = recurringMode === "daily" ? recurringDaysCount : recurringWeeksCount;
  const recurringUnitLabel = recurringMode === "daily" ? "day" : "week";
  const recurringUnitPluralLabel = recurringMode === "daily" ? "days" : "weeks";

  // Admin-flagged auto-apply coupons — highest priority (an event promo
  // like the worldcup-final discount outranks the new-user welcome code,
  // per product rule). applyCouponToHold runs the FULL validation
  // (platform, sport, BOOKING_DATE, caps) server-side, so a candidate
  // that doesn't fit this hold silently falls through to the next.
  useEffect(() => {
    // A pass offer is the better deal and can't combine with coupons —
    // auto-applying one would null the offer server-side and sabotage
    // the default "Book with my pass" selection. Manual coupon entry
    // stays available for customers who prefer it.
    if (passOffer) {
      setAutoCouponTried(true);
      return;
    }
    if (discountApplied) {
      setAutoCouponTried(true);
      return;
    }
    if (!autoApplyCodes || autoApplyCodes.length === 0) {
      setAutoCouponTried(true);
      return;
    }
    let cancelled = false;
    (async () => {
      for (const code of autoApplyCodes) {
        try {
          const persisted = await applyCouponToHold(holdId, code);
          if (cancelled) return;
          if (persisted.success && persisted.discountAmount) {
            setEffectiveAmount(amount - persisted.discountAmount);
            setDiscountApplied(true);
            setNewUserApplied(true); // reuse the applied-pill presentation
            setDiscountLabel(`${code} applied`);
            setBillNonce((n) => n + 1);
            trackCouponApplied(code, persisted.discountAmount);
            break;
          }
        } catch {
          // try the next candidate
        }
      }
      if (!cancelled) setAutoCouponTried(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per
    // hold + per Book-via base change (autoRetryNonce bumps a render
    // AFTER the reseed cleared the discount state, so the guards above
    // read fresh values and the whole priority chain re-runs).
  }, [holdId, autoRetryNonce]);

  // Auto-apply new user discount on mount via unified coupon system.
  // Persists the couponId on the SlotHold so that createBookingFromHold can
  // record a CouponUsage row + increment usedCount when the booking lands.
  useEffect(() => {
    if (!autoCouponTried) return;
    if (newUserDiscount && !discountApplied) {
      validateCoupon(newUserDiscount.code, {
        scope: "SPORTS",
        amount,
        sport,
        platform: "web",
      }).then(async (result) => {
        if (result.valid && result.couponId && result.discountAmount) {
          const persisted = await applyCouponToHold(holdId, newUserDiscount.code);
          if (!persisted.success) return;
          setEffectiveAmount(amount - result.discountAmount);
          setDiscountApplied(true);
          setNewUserApplied(true);
          setDiscountLabel(`New User: ${newUserDiscount.label}`);
          setBillNonce((n) => n + 1);
          trackNewUserDiscountApplied(result.discountAmount);
        }
      });
    }
  }, [autoCouponTried, newUserDiscount, discountApplied, amount, sport, holdId]);

  // Auto-apply launch / fallback coupon if no other discount applied.
  // The sport→code mapping lives in lib/auto-apply-promo.ts so the slot
  // page (which decorates tiles with strike-through prices) reads the
  // same code we apply here — keeps display + apply in sync if we ever
  // add another sport-specific launch promo.
  useEffect(() => {
    if (passOffer) return; // see the auto-apply gate above
    if (!autoCouponTried || discountApplied || newUserApplied) return;
    const fallbackCode = getAutoApplyCodeForSport(sport);
    const fallbackLabel =
      sport === "PICKLEBALL"
        ? "Pickleball Launch: 25% OFF applied"
        : "Flat ₹100 OFF applied";
    // Small delay to let new user discount apply first
    const timer = setTimeout(async () => {
      if (discountApplied) return;
      try {
        const result = await validateCoupon(fallbackCode, {
          scope: "SPORTS",
          amount,
          sport,
        });
        if (result.valid && result.couponId && result.discountAmount) {
          const persisted = await applyCouponToHold(holdId, fallbackCode);
          if (!persisted.success) return;
          setEffectiveAmount(amount - result.discountAmount);
          setDiscountApplied(true);
          setDiscountLabel(fallbackLabel);
          setBillNonce((n) => n + 1);
          trackCouponApplied(fallbackCode, result.discountAmount);
        }
      } catch {
        // Coupon may not exist yet — silently skip
      }
    }, 500);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, sport, newUserApplied, autoCouponTried, holdId]);

  // Advance payment calculation — computed against the FINAL payable
  // (post-coupon + post-points), so the 50% advance and remainder
  // line-items both already reflect the redemption discount.
  const advanceAmount = Math.ceil(payableAmount * 0.5);
  const remainingAmount = payableAmount - advanceAmount;

  const handleExpired = () => {
    trackLockExpired(holdId);
    router.push("/book?error=lock_expired");
  };

  const handleDiscountApplied = async (discountAmt: number, newTotal: number, code: string) => {
    // Persist the coupon to the hold so createBookingFromHold can record a
    // CouponUsage row when the booking lands. Without this, the coupon is
    // only ever reflected in the displayed total.
    const persisted = await applyCouponToHold(holdId, code);
    if (!persisted.success) return;
    setEffectiveAmount(newTotal);
    setDiscountApplied(true);
    setDiscountLabel(`Code: ${code} — ${formatPrice(discountAmt)} off`);
    // Also reset the points slider on user-driven coupon apply — same
    // reason as the auto-coupon path: the redemption cap is computed
    // off the post-coupon bill, so the slider needs a fresh preview.
    setPointsRedeemed(0);
    setPointsRedeemPaiseSaved(0);
    setBillNonce((n) => n + 1);
    trackCouponApplied(code, discountAmt);
  };

  // Undo an applied coupon. Clears it server-side (also nulls the redemption
  // columns), restores the pre-coupon total, and re-enables the DiscountInput.
  // The effectiveAmount change is broadcast to the summary tile by the
  // checkout:discount-changed effect above, so the Total reverts in lockstep.
  const handleDiscountRemoved = async () => {
    await clearCouponFromHold(holdId);
    setEffectiveAmount(amount);
    setDiscountApplied(false);
    setDiscountLabel(null);
    setPointsRedeemed(0);
    setPointsRedeemPaiseSaved(0);
    setBillNonce((n) => n + 1);
  };

  const handleRecurringAfterPayment = async () => {
    if (!recurringEnabled || !recurringCourtConfigId || !recurringStartDate) return;

    try {
      const result = await createRecurringBooking({
        courtConfigId: recurringCourtConfigId,
        startHour: recurringStartHour!,
        endHour: recurringEndHour!,
        dayOfWeek: recurringDayOfWeek!,
        startDate: recurringStartDate,
        mode: recurringMode,
        weeksCount: recurringWeeksCount,
        daysCount: recurringDaysCount,
      });

      if (result.success) {
        setRecurringResult({
          created: true,
          bookingsCreated: result.bookingsCreated,
          id: result.recurringBookingId,
        });
      }
    } catch (err) {
      console.error("Failed to create recurring booking:", err);
    }
  };

  // PhonePe: redirect-based flow.
  //
  // CRITICAL: always send the FULL `payableAmount` as overrideAmount,
  // even when isAdvance is true. The /api/phonepe/initiate (and
  // /api/razorpay/create-order) routes already apply
  // `Math.ceil(amount * 0.5)` when isAdvance is set. Previously this
  // client pre-halved the amount via `advanceAmount`, so the server
  // halved it AGAIN — customers paying the "50% Advance" tile ended
  // up paying 25%, with the missing 25% silently added to the
  // collect-at-venue total. Mobile already sends the full payable
  // and was unaffected; keep the contract consistent across clients.
  const handlePhonePePayment = async (isAdvance = false) => {
    const initAmount = isAdvance ? advanceAmount : payableAmount;
    trackPaymentInitiated("PHONEPE", initAmount, holdId);
    const res = await fetch("/api/phonepe/initiate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ holdId, isAdvance, overrideAmount: payableAmount }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error || "Failed"); return; }
    // Mark as completed before redirect — don't release hold on unload
    paymentCompletedRef.current = true;
    // Redirect to PhonePe checkout page
    window.location.href = data.redirectUrl;
  };

  // Razorpay: modal-based flow. See the PhonePe comment above — same
  // contract, the server halves the amount when isAdvance is set.
  const handleRazorpayPayment = async (isAdvance = false) => {
    const initAmount = isAdvance ? advanceAmount : payableAmount;
    trackPaymentInitiated("RAZORPAY", initAmount, holdId);
    const res = await fetch("/api/razorpay/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ holdId, offerId: isAdvance ? undefined : razorpayOfferId, isAdvance, overrideAmount: payableAmount }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error || "Failed"); return; }

    const options = {
      key: data.keyId,
      amount: data.amount,
      currency: data.currency,
      name: "Momentum Arena",
      description: isAdvance ? `Advance for Hold #${holdId.slice(-8)}` : `Booking Hold #${holdId.slice(-8)}`,
      order_id: data.orderId,
      ...(!isAdvance && razorpayOfferId ? { offer_id: razorpayOfferId } : {}),
      handler: async function (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) {
        try {
          const verifyRes = await fetch("/api/razorpay/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              holdId,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpayOrderId: response.razorpay_order_id,
              razorpaySignature: response.razorpay_signature,
              isAdvance,
            }),
          });
          const verifyData = await verifyRes.json();
          if (verifyRes.ok && verifyData.bookingId) {
            paymentCompletedRef.current = true;
            trackPaymentCompleted("RAZORPAY", initAmount, verifyData.bookingId);
            // RedeemSlider listens for this event to fire the
            // rewards_redeem_completed funnel step. Doing it via a
            // CustomEvent rather than a callback keeps the slider
            // component independent of every payment path.
            if (pointsRedeemed > 0) {
              window.dispatchEvent(
                new CustomEvent("rewards:redeem-completed", {
                  detail: {
                    points: pointsRedeemed,
                    paiseSaved: pointsRedeemPaiseSaved,
                  },
                }),
              );
            }
            if (!isAdvance) await handleRecurringAfterPayment();
            router.push(`/book/confirmation?id=${verifyData.bookingId}`);
          } else {
            trackPaymentFailed("RAZORPAY", holdId, verifyData.error || "Verification failed");
            setError(verifyData.error || "Payment verification failed. Please contact support.");
            setProcessing(false);
          }
        } catch {
          setError("Payment verification failed. Please contact support.");
          setProcessing(false);
        }
      },
      modal: {
        ondismiss: function () {
          // User closed Razorpay modal without completing payment
          trackPaymentCancelled("RAZORPAY", holdId);
          setProcessing(false);
        },
      },
      prefill: { name: userName, email: userEmail, contact: userPhone },
      theme: { color: "#10b981" },
    };

    const razorpay = new (window as unknown as { Razorpay: new (opts: typeof options) => { open: () => void } }).Razorpay(options);
    razorpay.open();
  };

  const handleOnlinePayment = async (isAdvance = false) => {
    if (gateway === "PHONEPE") {
      await handlePhonePePayment(isAdvance);
    } else {
      await handleRazorpayPayment(isAdvance);
    }
  };

  const handlePayment = async () => {
    setProcessing(true);
    setError(null);

    try {
      if (method === "gateway") {
        await handleOnlinePayment(amountMode === "advance");
      } else {
        // UPI — show the QR (DQR auto-confirm if enabled, else the
        // static QR + manual-verify flow). Hold stays active until the
        // booking is created.
        setShowUpiQr(true);
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setProcessing(false);
    }
  };

  // Shared post-confirmation side effects: fire the rewards-redeem
  // funnel step and kick off the recurring series (non-advance only).
  // Component-scope because both the legacy static-QR branch and the
  // DQR sheet overlay (rendered inside the main tree below) use it.
  const fireRewardsAndRecurring = (isAdvance: boolean) => {
    if (pointsRedeemed > 0) {
      window.dispatchEvent(
        new CustomEvent("rewards:redeem-completed", {
          detail: {
            points: pointsRedeemed,
            paiseSaved: pointsRedeemPaiseSaved,
          },
        }),
      );
    }
    if (!isAdvance) handleRecurringAfterPayment().catch(() => {});
  };

  return (
    <div className="space-y-6">
      {/* Countdown. Unmounted while a UPI sheet (DQR or static QR) is up —
          before the sheet refactor those steps replaced this whole tree, so
          the hold-expiry redirect never fired mid-payment; keep that
          behavior. */}
      {!showUpiQr && (
        <CountdownTimer expiresAt={new Date(expiresAt)} onExpired={handleExpired} />
      )}

      {/* Recurring booking notice */}
      {recurringEnabled && recurringCount && perSessionAmount && (
        <div className={`rounded-xl border p-3 space-y-1 ${
          recurringMode === "daily"
            ? "border-blue-500/20 bg-blue-500/5"
            : "border-blue-500/20 bg-blue-500/5"
        }`}>
          <div className="flex items-center gap-2">
            {recurringMode === "daily" ? (
              <Calendar className="h-4 w-4 text-blue-400 shrink-0" />
            ) : (
              <RefreshCw className="h-4 w-4 text-blue-400 shrink-0" />
            )}
            <span className="text-sm font-medium text-blue-400">
              {recurringMode === "daily"
                ? `Daily booking — ${recurringCount} consecutive days`
                : `Weekly booking — ${recurringCount} weeks`}
            </span>
          </div>
          <p className="text-xs text-blue-400/70 ml-6">
            {formatPrice(perSessionAmount)}/{recurringUnitLabel} {"\u00D7"} {recurringCount} {recurringCount === 1 ? recurringUnitLabel : recurringUnitPluralLabel}
            {recurringDiscountPercent ? ` — ${recurringDiscountPercent}% off` : ""} = <strong className="text-blue-300">{formatPrice(amount)}</strong> total
          </p>
        </div>
      )}

      {/* Recurring series created confirmation */}
      {recurringResult?.created && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
          <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
          <span className="text-sm text-emerald-400">
            Recurring series created! {recurringResult.bookingsCreated} upcoming bookings scheduled.
          </span>
        </div>
      )}

      {/* New User Discount Badge */}
      {newUserApplied && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
          <Sparkles className="h-4 w-4 text-emerald-400" />
          <span className="text-sm text-emerald-400">
            {discountLabel} — New total: <strong>{formatPrice(effectiveAmount)}</strong>
          </span>
        </div>
      )}

      {/* Discount Code Input */}
      {!newUserApplied && (
        <div>
          <h2 className="mb-2 text-sm font-medium text-zinc-400">Discount Code</h2>
          <DiscountInput
            bookingAmount={amount}
            sport={sport}
            disabled={discountApplied}
            disabledMessage={discountLabel || "Discount applied"}
            onDiscountApplied={handleDiscountApplied}
            onRemove={handleDiscountRemoved}
          />
        </div>
      )}

      {/* Momentum Points redemption + redemption summary pill have
          moved INTO the Booking Summary tile (just above the Total
          row) per the customer's request. The SummaryFooter client
          island in app/book/checkout/page.tsx renders the checkbox
          + reactive Total and dispatches a `checkout:redemption-
          changed` window event whenever the pick changes — we
          listen for it in the useEffect below to keep
          `pointsRedeemed` / `pointsRedeemPaiseSaved` in sync with
          the payment-gateway buttons that follow. */}

      {/* Included Equipment Banner — surfaces the "kit included in the
          slot price" hint only when this booking doesn't carry any
          rental gear (the slot-selection page already lets the user
          add rentals if they want; this is a positive reminder that
          for cricket/football boxes the basics are free). */}
      {sport === "CRICKET" && lockedEquipmentTotalRupees === 0 && (
        <div className="rounded-xl bg-zinc-800/60 px-4 py-3 flex items-center gap-2">
          <span className="text-base">🏏</span>
          <p className="text-sm text-zinc-300">Equipment (stumps, bats, and balls) is covered in the pricing.</p>
        </div>
      )}
      {sport === "FOOTBALL" && (
        <div className="rounded-xl bg-zinc-800/60 px-4 py-3 flex items-center gap-2">
          <span className="text-base">⚽</span>
          <p className="text-sm text-zinc-300">Equipment (football and keeping gloves) is covered in the pricing.</p>
        </div>
      )}

      {/* Rental "Rent gear" card moved upstream — it now lives above
          the Continue button on the slot-selection page (see
          components/booking/gear-picker.tsx). The per-item line is
          rendered server-side in page.tsx from hold.equipmentSelection
          alongside the slot total in the Booking Summary tile. */}

      {/* Payment Method */}
      <div>
        <h2 className="mb-3 font-semibold text-white">Payment Method</h2>
        <PaymentSelector
          amountMode={amountMode}
          onAmountModeChange={(m) => {
            setAmountMode(m);
            trackPaymentMethodSelected(`${m}_${method}`);
            void logPaymentMethodSelected(holdId, `${m}_${method}`);
          }}
          method={method}
          onMethodChange={(m) => {
            setMethod(m);
            trackPaymentMethodSelected(`${amountMode}_${m}`);
            void logPaymentMethodSelected(holdId, `${amountMode}_${m}`);
          }}
          gateway={gateway}
          fullAmount={payableAmount}
          advanceAmount={advanceAmount}
          remainingAmount={remainingAmount}
          onlineEnabled={onlineEnabled}
          upiQrEnabled={upiQrEnabled}
          advanceEnabled={advanceEnabled}
          passAvailable={!!passOffer}
          passName={passOffer?.passName}
          passDesc={
            passOffer
              ? passOffer.fullCoverage
                ? "Pay ₹0 — fully covered by your pass"
                : `Pass + pay ${formatPrice(passOffer.remainderAmount)}`
              : undefined
          }
        />

        {/* Pass confirm — replaces the pay button while "Book with my
            pass" is the selected option. */}
        {amountMode === "pass" && passOffer && (
          <div className="mt-3">
            <PassCheckoutOption holdId={holdId} offer={passOffer} />
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-center text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Pay Button — hidden while the pass option is selected (the
          pass card above carries its own confirm button). */}
      <button
        onClick={handlePayment}
        disabled={processing || amountMode === "pass"}
        hidden={amountMode === "pass"}
        className="w-full rounded-xl bg-emerald-600 px-6 py-3.5 font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
      >
        {processing ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Processing...
          </span>
        ) : method === "gateway" ? (
          amountMode === "advance"
            ? `Pay Advance ${formatPrice(advanceAmount)}`
            : `Pay ${formatPrice(payableAmount)}`
        ) : amountMode === "advance" ? (
          `Pay Advance ${formatPrice(advanceAmount)} via UPI`
        ) : (
          `Pay ${formatPrice(payableAmount)} via UPI`
        )}
      </button>

      {/* DQR: auto-confirming dynamic QR, shown as a Razorpay-style bottom
          sheet OVER the checkout (the page above stays mounted and dimmed).
          The booking is created server-side on payment; onConfirmed
          navigates straight to the confirmation. */}
      {showUpiQr && dqrEnabled && (
        <DqrCheckout
          holdId={holdId}
          amount={amountMode === "advance" ? advanceAmount : payableAmount}
          overrideAmount={payableAmount}
          isAdvance={amountMode === "advance"}
          advanceAmount={amountMode === "advance" ? advanceAmount : undefined}
          remainingAmount={
            amountMode === "advance" ? remainingAmount : undefined
          }
          onConfirmed={(bookingId) => {
            paymentCompletedRef.current = true;
            fireRewardsAndRecurring(amountMode === "advance");
            router.push(`/book/confirmation?id=${bookingId}`);
          }}
          onCancel={() => {
            setShowUpiQr(false);
            releaseLock();
            router.back();
          }}
        />
      )}

      {/* Legacy static QR: same Razorpay-style bottom sheet OVER the
          checkout (page stays mounted and dimmed, countdown paused —
          identical overlay pattern to the DQR branch above). Booking is
          created PENDING when the user taps "I've completed the payment";
          verified later via WhatsApp screenshot / admin. */}
      {showUpiQr && !dqrEnabled && (
        <UpiQrCheckout
          amount={amountMode === "advance" ? advanceAmount : payableAmount}
          bookingId={holdId}
          isAdvance={amountMode === "advance"}
          advanceAmount={
            amountMode === "advance" ? advanceAmount : undefined
          }
          remainingAmount={
            amountMode === "advance" ? remainingAmount : undefined
          }
          onPaymentInitiated={async () => {
            const isAdvance = amountMode === "advance";
            // Mark paymentCompleted so the hold isn't released by unload/unmount.
            paymentCompletedRef.current = true;
            // For the 50% advance flow, the customer paid only the advance
            // via UPI QR — record that (not the full price) so the Payment
            // leaves a remainingAmount to collect at the venue.
            const commit = isAdvance
              ? await selectCashPayment(holdId, advanceAmount, { isAdvance: true })
              : await selectUpiPayment(holdId, payableAmount);

            if (commit.success && commit.bookingId) {
              fireRewardsAndRecurring(isAdvance);
              // Don't router.push — UpiQrCheckout stays on its "paid" step
              // so the user can share the payment screenshot on WhatsApp.
              return { bookingId: commit.bookingId };
            }

            paymentCompletedRef.current = false;
            return { error: commit.error || "Failed to create booking" };
          }}
          onCancel={() => {
            setShowUpiQr(false);
            releaseLock();
            router.back();
          }}
        />
      )}
    </div>
  );
}
