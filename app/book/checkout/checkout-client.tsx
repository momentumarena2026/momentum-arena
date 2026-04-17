"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { CountdownTimer } from "@/components/booking/countdown-timer";
import { PaymentSelector, type PaymentMethodType } from "@/components/payment/payment-selector";
import { AdvancePaymentSelector, type AdvancePaymentMethod } from "@/components/payment/advance-payment-selector";
import { DiscountInput } from "@/components/booking/discount-input";
import { UpiQrCheckout } from "@/components/payment/upi-qr-checkout";
import { formatPrice } from "@/lib/pricing";
import { validateCoupon } from "@/actions/coupon-validation";
import { selectCashPayment, selectUpiPayment } from "@/actions/booking";
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
}: CheckoutClientProps) {
  const router = useRouter();
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodType>("online");
  const [advanceMethod, setAdvanceMethod] = useState<AdvancePaymentMethod>("online");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUpiQr, setShowUpiQr] = useState(false);

  // Discount state
  const [effectiveAmount, setEffectiveAmount] = useState(amount);
  const [discountApplied, setDiscountApplied] = useState(false);
  const [discountLabel, setDiscountLabel] = useState<string | null>(null);
  const [newUserApplied, setNewUserApplied] = useState(false);

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
  // NOTE: actual coupon usage tracking happens server-side when the Booking
  // is created — at this stage we only validate and reduce the displayed total.
  useEffect(() => {
    if (newUserDiscount && !discountApplied) {
      validateCoupon(newUserDiscount.code, {
        scope: "SPORTS",
        amount,
        sport,
      }).then((result) => {
        if (result.valid && result.couponId && result.discountAmount) {
          setEffectiveAmount(amount - result.discountAmount);
          setDiscountApplied(true);
          setNewUserApplied(true);
          setDiscountLabel(`New User: ${newUserDiscount.label}`);
          trackNewUserDiscountApplied(result.discountAmount);
        }
      });
    }
  }, [newUserDiscount, discountApplied, amount, sport]);

  // Auto-apply FLAT100 coupon if no other discount applied
  useEffect(() => {
    if (discountApplied || newUserApplied) return;
    // Small delay to let new user discount apply first
    const timer = setTimeout(async () => {
      if (discountApplied) return;
      try {
        const result = await validateCoupon("FLAT100", {
          scope: "SPORTS",
          amount,
          sport,
        });
        if (result.valid && result.couponId && result.discountAmount) {
          setEffectiveAmount(amount - result.discountAmount);
          setDiscountApplied(true);
          setDiscountLabel(`Flat ₹100 OFF applied`);
          trackCouponApplied("FLAT100", result.discountAmount);
        }
      } catch {
        // Coupon may not exist yet — silently skip
      }
    }, 500);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, sport, newUserApplied]);

  // Advance payment calculation
  const advanceAmount = Math.ceil(effectiveAmount * 0.5);
  const remainingAmount = effectiveAmount - advanceAmount;

  const handleExpired = () => {
    trackLockExpired(holdId);
    router.push("/book?error=lock_expired");
  };

  const handleDiscountApplied = (discountAmt: number, newTotal: number, code: string) => {
    setEffectiveAmount(newTotal);
    setDiscountApplied(true);
    setDiscountLabel(`Code: ${code} — ${formatPrice(discountAmt)} off`);
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

  // PhonePe: redirect-based flow
  const handlePhonePePayment = async (isAdvance = false) => {
    trackPaymentInitiated("PHONEPE", effectiveAmount, holdId);
    const res = await fetch("/api/phonepe/initiate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ holdId, isAdvance, overrideAmount: effectiveAmount }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error || "Failed"); return; }
    // Mark as completed before redirect — don't release hold on unload
    paymentCompletedRef.current = true;
    // Redirect to PhonePe checkout page
    window.location.href = data.redirectUrl;
  };

  // Razorpay: modal-based flow
  const handleRazorpayPayment = async (isAdvance = false) => {
    trackPaymentInitiated("RAZORPAY", effectiveAmount, holdId);
    const res = await fetch("/api/razorpay/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ holdId, offerId: isAdvance ? undefined : razorpayOfferId, isAdvance, overrideAmount: effectiveAmount }),
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
            trackPaymentCompleted("RAZORPAY", effectiveAmount, verifyData.bookingId);
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
    const upiAmount = paymentMethod === "cash" ? advanceAmount : effectiveAmount;
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
            const commit =
              paymentMethod === "cash"
                ? await selectCashPayment(holdId, effectiveAmount)
                : await selectUpiPayment(holdId, effectiveAmount);

            if (commit.success && commit.bookingId) {
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

      {/* Included Equipment Banner */}
      {sport === "CRICKET" && (
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

      {/* Payment Method */}
      <div>
        <h2 className="mb-3 font-semibold text-white">Payment Method</h2>
        <PaymentSelector selected={paymentMethod} onSelect={(m) => { setPaymentMethod(m); trackPaymentMethodSelected(m); }} gateway={gateway} />
      </div>

      {/* Advance Payment for Cash */}
      {paymentMethod === "cash" && (
        <AdvancePaymentSelector
          totalAmount={effectiveAmount}
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
          `Pay ${formatPrice(effectiveAmount)}`
        ) : paymentMethod === "upi_qr" ? (
          `Show QR — ${formatPrice(effectiveAmount)}`
        ) : (
          `Pay Advance ${formatPrice(advanceAmount)} — Book Now`
        )}
      </button>

    </div>
  );
}
