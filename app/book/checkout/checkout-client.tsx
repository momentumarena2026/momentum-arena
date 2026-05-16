"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { CountdownTimer } from "@/components/booking/countdown-timer";
import { PaymentSelector, type PaymentMethodType } from "@/components/payment/payment-selector";
import { AdvancePaymentSelector, type AdvancePaymentMethod } from "@/components/payment/advance-payment-selector";
import { DiscountInput } from "@/components/booking/discount-input";
import { RedeemSlider } from "@/components/rewards/redeem-slider";
import { UpiQrCheckout } from "@/components/payment/upi-qr-checkout";
import { formatPrice } from "@/lib/pricing";
import { validateCoupon } from "@/actions/coupon-validation";
import {
  selectCashPayment,
  selectUpiPayment,
  applyCouponToHold,
  clearCouponFromHold,
  applyEquipmentSelectionToHold,
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
  perSessionAmount?: number;
  recurringDiscountPercent?: number;
  sport?: string;
  expiresAt: string;
  userName: string;
  userEmail: string;
  userPhone: string;
  razorpayOfferId?: string;
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
  /** Rentable equipment surfaced as a checkbox list. Empty array =
   *  no equipment section in the UI. Prices are in WHOLE RUPEES. */
  equipmentOptions?: Array<{
    id: string;
    name: string;
    priceRupees: number;
    imageUrl: string | null;
  }>;
  /** Number of BookingSlot rows on the hold. Rental rates are
   *  per-slot — display total = priceRupees × slotCount. */
  slotCount?: number;
}

export function CheckoutClient({
  holdId,
  amount,
  perSessionAmount,
  recurringDiscountPercent,
  sport,
  expiresAt,
  userName,
  userEmail,
  userPhone,
  razorpayOfferId,
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
  equipmentOptions = [],
  slotCount = 1,
}: CheckoutClientProps) {
  const router = useRouter();
  // Default selection to the first method that's currently enabled so the
  // user never lands on a hidden tile.
  const initialMethod: PaymentMethodType = onlineEnabled
    ? "online"
    : upiQrEnabled
      ? "upi_qr"
      : "cash";
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodType>(initialMethod);
  const [advanceMethod, setAdvanceMethod] = useState<AdvancePaymentMethod>("online");
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

  // Reward redemption state — driven by the RedeemSlider child. The
  // server keeps the canonical pointsToRedeem on the SlotHold; this
  // local copy is just so we can compute the payable and pass it to
  // the gateway initiation calls.
  const [pointsRedeemed, setPointsRedeemed] = useState(0);
  const [pointsRedeemPaiseSaved, setPointsRedeemPaiseSaved] = useState(0);
  // Bumped whenever the coupon mutates so the slider re-fetches the
  // preview (and resets to 0). applyCouponToHold / clearCouponFromHold
  // already null out the redemption columns server-side; bumping the
  // nonce keeps the UI in lockstep.
  const [billNonce, setBillNonce] = useState(0);

  const pointsRedeemRupees = Math.floor(pointsRedeemPaiseSaved / 100);

  // Equipment-rental selection state. Each entry is the equipment row
  // id — quantities default to 1 each (the venue's gear is one-per-
  // booking, no need for a quantity stepper). Server is the source of
  // truth; we sync via applyEquipmentSelectionToHold on every toggle.
  const [equipmentIds, setEquipmentIds] = useState<Set<string>>(new Set());
  // Rental rate is per-slot — scale by slotCount so a 3-slot
  // booking with a ₹100/slot rental shows ₹300 here. Server-side
  // applyEquipmentSelectionToHold uses the same multiplier when
  // it writes the snapshot.
  const rentalMultiplier = Math.max(1, slotCount);
  const equipmentTotalRupees = Array.from(equipmentIds).reduce((sum, id) => {
    const opt = equipmentOptions.find((o) => o.id === id);
    return sum + (opt?.priceRupees ?? 0) * rentalMultiplier;
  }, 0);

  // Final payable = slot total - all discounts + equipment rentals.
  // Same convention used by createBookingFromHold so the gateway
  // amount and the booking row line up exactly.
  const payableAmount = Math.max(
    0,
    effectiveAmount - pointsRedeemRupees + equipmentTotalRupees,
  );

  async function toggleEquipment(id: string) {
    setEquipmentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      // Fire-and-forget — the server validates + re-prices. UI
      // already reflects the new state from the optimistic toggle.
      void applyEquipmentSelectionToHold(
        holdId,
        Array.from(next).map((eid) => ({ equipmentId: eid, quantity: 1 })),
      );
      return next;
    });
  }

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

  // Auto-apply new user discount on mount via unified coupon system.
  // Persists the couponId on the SlotHold so that createBookingFromHold can
  // record a CouponUsage row + increment usedCount when the booking lands.
  useEffect(() => {
    if (newUserDiscount && !discountApplied) {
      validateCoupon(newUserDiscount.code, {
        scope: "SPORTS",
        amount,
        sport,
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
  }, [newUserDiscount, discountApplied, amount, sport, holdId]);

  // Auto-apply launch / fallback coupon if no other discount applied.
  // Pickleball gets PICKLEBALL25 (flat 25% off — launch promo, sport-
  // filtered server-side); every other sport falls back to FLAT100.
  // We pick by sport instead of trying both in order because PICKLEBALL25
  // is sport-filtered → validateCoupon rejects it for non-pickleball
  // anyway, and FLAT100 is not sport-filtered → it would shadow the
  // pickleball promo if tried first. Single-shot keeps the network
  // chatter down and the UI label deterministic.
  useEffect(() => {
    if (discountApplied || newUserApplied) return;
    const fallbackCode = sport === "PICKLEBALL" ? "PICKLEBALL25" : "FLAT100";
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
  }, [amount, sport, newUserApplied, holdId]);

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
      if (paymentMethod === "online") {
        await handleOnlinePayment(false);
      } else if (paymentMethod === "upi_qr") {
        // Just show the QR — don't commit yet. Hold stays active, and will be
        // released if user leaves before clicking "I've completed the payment".
        setShowUpiQr(true);
      } else if (paymentMethod === "cash") {
        if (advanceMethod === "online") {
          await handleOnlinePayment(true);
        } else {
          // Same as UPI QR: booking is only created after user confirms payment
          setShowUpiQr(true);
        }
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setProcessing(false);
    }
  };

  if (showUpiQr) {
    const upiAmount = paymentMethod === "cash" ? advanceAmount : payableAmount;
    return (
      <div className="space-y-4">
        <UpiQrCheckout
          amount={upiAmount}
          bookingId={holdId}
          isAdvance={paymentMethod === "cash"}
          advanceAmount={paymentMethod === "cash" ? advanceAmount : undefined}
          onPaymentInitiated={async () => {
            // User clicked "I've completed the payment" — commit the booking as PENDING.
            // Mark paymentCompleted so the hold isn't released by unload/unmount handlers.
            paymentCompletedRef.current = true;
            // For the 50% advance flow, the customer only paid the advance
            // amount via UPI QR — pass that (not the full slot price) so
            // the Payment row records the correct amount and leaves a
            // remainingAmount = half to collect at the venue.
            const commit =
              paymentMethod === "cash"
                ? await selectCashPayment(holdId, advanceAmount, { isAdvance: true })
                : await selectUpiPayment(holdId, payableAmount);

            if (commit.success && commit.bookingId) {
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
              // Fire-and-forget recurring series creation for non-advance UPI.
              if (paymentMethod === "upi_qr") {
                handleRecurringAfterPayment().catch(() => {});
              }
              // Do NOT router.push here — the UpiQrCheckout component now stays
              // on its "paid" step so the user can share their payment
              // screenshot on WhatsApp before navigating to the confirmation.
              return { bookingId: commit.bookingId };
            }

            paymentCompletedRef.current = false;
            return { error: commit.error || "Failed to create booking" };
          }}
          onCancel={() => { releaseLock(); router.back(); }}
        />
        {paymentMethod === "cash" && (
          <p className="text-center text-xs text-yellow-400">
            Paying advance: {formatPrice(advanceAmount)} • Remaining at venue: {formatPrice(remainingAmount)}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Countdown */}
      <CountdownTimer expiresAt={new Date(expiresAt)} onExpired={handleExpired} />

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
          />
        </div>
      )}

      {/* Momentum Points redemption — auto-hidden if disabled / no balance */}
      <RedeemSlider
        holdId={holdId}
        billRupees={effectiveAmount}
        billNonce={billNonce}
        onChange={({ points, paiseSaved }) => {
          setPointsRedeemed(points);
          setPointsRedeemPaiseSaved(paiseSaved);
        }}
      />

      {/* Redemption summary line — only shows when the user has actually
          dragged the slider above 0. Kept compact so it doesn't fight
          the existing "discount applied" pill. */}
      {pointsRedeemed > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm">
          <span className="text-emerald-300">
            {pointsRedeemed.toLocaleString("en-IN")} pts applied
          </span>
          <span className="text-emerald-300">
            -{formatPrice(pointsRedeemRupees)} · New total{" "}
            <strong className="text-white">{formatPrice(payableAmount)}</strong>
          </span>
        </div>
      )}

      {/* Included Equipment Banner */}
      {sport === "CRICKET" && equipmentOptions.length === 0 && (
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

      {/* Rentable equipment — currently only the bowling-machine
          checkout surfaces a non-empty list. Each toggle persists
          via applyEquipmentSelectionToHold; the server re-prices so
          the client can't smuggle a cheaper rental. */}
      {equipmentOptions.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Rent gear</h3>
            <span className="text-xs text-zinc-500">Optional · pay-per-booking</span>
          </div>
          <div className="space-y-1.5">
            {equipmentOptions.map((opt) => {
              const checked = equipmentIds.has(opt.id);
              return (
                <label
                  key={opt.id}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors cursor-pointer ${
                    checked
                      ? "border-emerald-500/40 bg-emerald-500/5"
                      : "border-zinc-800 bg-zinc-950 hover:border-zinc-700"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleEquipment(opt.id)}
                    className="h-4 w-4 accent-emerald-500"
                  />
                  <span className="flex-1 text-sm text-white">
                    {opt.name}
                    {rentalMultiplier > 1 ? (
                      <span className="ml-1 text-[10px] text-zinc-500">
                        ({formatPrice(opt.priceRupees)} × {rentalMultiplier} slots)
                      </span>
                    ) : null}
                  </span>
                  <span
                    className={`text-sm font-semibold ${
                      checked ? "text-emerald-300" : "text-zinc-400"
                    }`}
                  >
                    +{formatPrice(opt.priceRupees * rentalMultiplier)}
                  </span>
                </label>
              );
            })}
          </div>
          {equipmentTotalRupees > 0 && (
            <div className="flex items-center justify-between rounded-lg bg-emerald-500/5 px-3 py-2 text-sm">
              <span className="text-zinc-300">
                Gear rental · {equipmentIds.size} item{equipmentIds.size === 1 ? "" : "s"}
              </span>
              <span className="font-semibold text-emerald-300">
                +{formatPrice(equipmentTotalRupees)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Payment Method */}
      <div>
        <h2 className="mb-3 font-semibold text-white">Payment Method</h2>
        <PaymentSelector
          selected={paymentMethod}
          onSelect={(m) => { setPaymentMethod(m); trackPaymentMethodSelected(m); }}
          gateway={gateway}
          onlineEnabled={onlineEnabled}
          upiQrEnabled={upiQrEnabled}
          advanceEnabled={advanceEnabled}
        />
      </div>

      {/* Advance Payment for Cash */}
      {paymentMethod === "cash" && (
        <AdvancePaymentSelector
          totalAmount={payableAmount}
          advanceAmount={advanceAmount}
          remainingAmount={remainingAmount}
          selected={advanceMethod}
          onSelect={setAdvanceMethod}
          gateway={gateway}
        />
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-center text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Pay Button */}
      <button
        onClick={handlePayment}
        disabled={processing}
        className="w-full rounded-xl bg-emerald-600 px-6 py-3.5 font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
      >
        {processing ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Processing...
          </span>
        ) : paymentMethod === "online" ? (
          `Pay ${formatPrice(payableAmount)}`
        ) : paymentMethod === "upi_qr" ? (
          `Show QR — ${formatPrice(payableAmount)}`
        ) : (
          `Pay Advance ${formatPrice(advanceAmount)} — Book Now`
        )}
      </button>

    </div>
  );
}
