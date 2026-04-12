"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { CountdownTimer } from "@/components/booking/countdown-timer";
import { PaymentSelector, type PaymentMethodType } from "@/components/payment/payment-selector";
import { AdvancePaymentSelector, type AdvancePaymentMethod } from "@/components/payment/advance-payment-selector";
import { DiscountInput } from "@/components/booking/discount-input";
import { UpiQrCheckout } from "@/components/payment/upi-qr-checkout";
import { formatPrice } from "@/lib/pricing";
import { validateCoupon, applyCoupon } from "@/actions/coupon-validation";
import { selectCashPayment } from "@/actions/booking";
// UTR submission disabled — admin verifies via WhatsApp screenshot
import { getAvailableEquipment, addEquipmentToBooking } from "@/actions/equipment";
import { createRecurringBooking } from "@/actions/recurring-booking";
import { Loader2, Sparkles, Package, RefreshCw, Calendar, CheckCircle, Plus, Minus } from "lucide-react";

interface EquipmentItem {
  id: string;
  name: string;
  sport: string | null;
  pricePerHour: number;
  totalPriceForDuration: number;
  availableUnits: number;
  imageUrl: string | null;
}

interface CheckoutClientProps {
  bookingId: string;
  amount: number;
  perSessionAmount?: number;
  recurringDiscountPercent?: number;
  sport?: string;
  lockExpiresAt: string;
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
  bookingId,
  amount,
  perSessionAmount,
  recurringDiscountPercent,
  sport,
  lockExpiresAt,
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

  // Equipment state
  const [equipment, setEquipment] = useState<EquipmentItem[]>([]);
  const [equipmentLoading, setEquipmentLoading] = useState(false);
  const [selectedEquipment, setSelectedEquipment] = useState<Map<string, number>>(new Map());
  const [equipmentTotal, setEquipmentTotal] = useState(0);

  // Recurring confirmation state
  const [recurringResult, setRecurringResult] = useState<{ created: boolean; bookingsCreated?: number; id?: string } | null>(null);

  // Track whether payment was completed (don't release lock if payment succeeded)
  const paymentCompletedRef = useRef(false);

  // Release lock when user leaves checkout without paying
  const releaseLock = useCallback(() => {
    if (paymentCompletedRef.current) return;
    // Use sendBeacon for reliability — works even during page unload
    const payload = JSON.stringify({ bookingId });
    navigator.sendBeacon("/api/booking/release-lock", payload);
  }, [bookingId]);

  useEffect(() => {
    // Release lock on browser close / tab close / navigation away
    window.addEventListener("beforeunload", releaseLock);
    return () => {
      window.removeEventListener("beforeunload", releaseLock);
      // Also release on React unmount (in-app navigation like back button)
      releaseLock();
    };
  }, [releaseLock]);

  // Derived recurring values
  const recurringCount = recurringMode === "daily" ? recurringDaysCount : recurringWeeksCount;
  const recurringUnitLabel = recurringMode === "daily" ? "day" : "week";
  const recurringUnitPluralLabel = recurringMode === "daily" ? "days" : "weeks";

  // Auto-apply new user discount on mount via unified coupon system
  useEffect(() => {
    if (newUserDiscount && !discountApplied) {
      validateCoupon(newUserDiscount.code, {
        scope: "SPORTS",
        amount,
        sport,
      }).then(async (result) => {
        if (result.valid && result.couponId && result.discountAmount) {
          await applyCoupon(result.couponId, "", {
            bookingId,
            discountAmount: result.discountAmount,
          });
          setEffectiveAmount(amount - result.discountAmount);
          setDiscountApplied(true);
          setNewUserApplied(true);
          setDiscountLabel(`New User: ${newUserDiscount.label}`);
        }
      });
    }
  }, [newUserDiscount, bookingId, discountApplied, amount, sport]);

  // Fetch available equipment
  useEffect(() => {
    if (!sport || !bookingDate || startHour === undefined || endHour === undefined) return;

    setEquipmentLoading(true);
    getAvailableEquipment(
      sport as Parameters<typeof getAvailableEquipment>[0],
      bookingDate,
      startHour,
      endHour
    ).then((result) => {
      if (result.success) {
        setEquipment(result.equipment);
      }
    }).finally(() => setEquipmentLoading(false));
  }, [sport, bookingDate, startHour, endHour]);

  // Recalculate equipment total whenever selectedEquipment changes
  useEffect(() => {
    let total = 0;
    for (const [equipId, qty] of selectedEquipment.entries()) {
      const item = equipment.find((e) => e.id === equipId);
      if (item) total += item.totalPriceForDuration * qty;
    }
    setEquipmentTotal(total);
  }, [selectedEquipment, equipment]);

  // Advance payment calculation
  const advanceAmount = Math.ceil(effectiveAmount * 0.5);
  const remainingAmount = effectiveAmount - advanceAmount;

  const handleExpired = () => {
    router.push("/book?error=lock_expired");
  };

  const handleDiscountApplied = (discountAmt: number, newTotal: number, code: string) => {
    setEffectiveAmount(newTotal);
    setDiscountApplied(true);
    setDiscountLabel(`Code: ${code} — ${formatPrice(discountAmt)} off`);
  };

  const handleEquipmentQtyChange = (equipId: string, delta: number) => {
    setSelectedEquipment((prev) => {
      const next = new Map(prev);
      const current = next.get(equipId) || 0;
      const item = equipment.find((e) => e.id === equipId);
      if (!item) return prev;

      const newQty = Math.max(0, Math.min(item.availableUnits, current + delta));
      if (newQty === 0) {
        next.delete(equipId);
      } else {
        next.set(equipId, newQty);
      }
      return next;
    });
  };

  const addEquipmentAfterBooking = async (bId: string) => {
    if (selectedEquipment.size === 0) return;
    const items = Array.from(selectedEquipment.entries()).map(([equipmentId, quantity]) => ({
      equipmentId,
      quantity,
    }));
    await addEquipmentToBooking(bId, items);
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
    const res = await fetch("/api/phonepe/initiate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId, isAdvance, overrideAmount: effectiveAmount }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error || "Failed"); return; }
    // Mark as completed before redirect — don't release lock on unload
    paymentCompletedRef.current = true;
    // Redirect to PhonePe checkout page
    window.location.href = data.redirectUrl;
  };

  // Razorpay: modal-based flow
  const handleRazorpayPayment = async (isAdvance = false) => {
    const res = await fetch("/api/razorpay/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId, offerId: isAdvance ? undefined : razorpayOfferId, isAdvance, overrideAmount: effectiveAmount }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error || "Failed"); return; }

    const options = {
      key: data.keyId,
      amount: data.amount,
      currency: data.currency,
      name: "Momentum Arena",
      description: isAdvance ? `Advance for Booking #${bookingId.slice(-8)}` : `Booking #${bookingId.slice(-8)}`,
      order_id: data.orderId,
      ...(!isAdvance && razorpayOfferId ? { offer_id: razorpayOfferId } : {}),
      handler: async function (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) {
        try {
          const verifyRes = await fetch("/api/razorpay/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bookingId, razorpayPaymentId: response.razorpay_payment_id, razorpayOrderId: response.razorpay_order_id, razorpaySignature: response.razorpay_signature, isAdvance }),
          });
          if (verifyRes.ok) {
            paymentCompletedRef.current = true;
            await addEquipmentAfterBooking(bookingId);
            if (!isAdvance) await handleRecurringAfterPayment();
            router.push(`/book/confirmation/${bookingId}`);
          } else {
            setError("Payment verification failed. Please contact support.");
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
        const { selectUpiPayment } = await import("@/actions/booking");
        const result = await selectUpiPayment(bookingId, effectiveAmount);
        if (!result.success) { setError(result.error || "Failed"); setProcessing(false); return; }
        paymentCompletedRef.current = true; // UPI QR initiated — don't release lock
        setShowUpiQr(true);
      } else if (paymentMethod === "cash") {
        if (advanceMethod === "online") {
          await handleOnlinePayment(true);
        } else {
          setShowUpiQr(true);
          const result = await selectCashPayment(bookingId, effectiveAmount);
          if (!result.success) { setError(result.error || "Failed"); setShowUpiQr(false); return; }
          paymentCompletedRef.current = true; // Cash payment initiated — don't release lock
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
          bookingId={bookingId}
          isAdvance={paymentMethod === "cash"}
          advanceAmount={paymentMethod === "cash" ? advanceAmount : undefined}
          onPaymentInitiated={() => {
            // Slot is already locked — user will get confirmation after admin verifies
          }}
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
      <CountdownTimer expiresAt={new Date(lockExpiresAt)} onExpired={handleExpired} />

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
            bookingId={bookingId}
            bookingAmount={amount}
            sport={sport}
            disabled={discountApplied}
            disabledMessage={discountLabel || "Discount applied"}
            onDiscountApplied={handleDiscountApplied}
          />
        </div>
      )}

      {/* Equipment Rental Section */}
      <div>
        <h2 className="mb-3 font-semibold text-white flex items-center gap-2">
          <Package className="h-4 w-4 text-zinc-400" />
          Equipment Rental
          <span className="text-xs font-normal text-zinc-500">(Optional)</span>
        </h2>

        {equipmentLoading ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="flex items-center gap-2 text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading available equipment...</span>
            </div>
          </div>
        ) : equipment.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 text-center text-sm text-zinc-500">
            No equipment available for rental
          </div>
        ) : (
          <div className="space-y-2">
            {equipment.map((item) => {
              const qty = selectedEquipment.get(item.id) || 0;
              return (
                <div
                  key={item.id}
                  className={`rounded-xl border p-3 transition-colors ${
                    qty > 0
                      ? "border-emerald-500/30 bg-emerald-500/5"
                      : "border-zinc-800 bg-zinc-900"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-white">{item.name}</p>
                      <p className="text-xs text-zinc-500">
                        {formatPrice(item.pricePerHour)}/hr {"\u2022"} {item.availableUnits} available
                      </p>
                      {qty > 0 && (
                        <p className="text-xs text-emerald-400 mt-0.5">
                          +{formatPrice(item.totalPriceForDuration * qty)} for this booking
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleEquipmentQtyChange(item.id, -1)}
                        disabled={qty === 0}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="w-5 text-center text-sm font-medium text-white">{qty}</span>
                      <button
                        onClick={() => handleEquipmentQtyChange(item.id, 1)}
                        disabled={qty >= item.availableUnits}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {equipmentTotal > 0 && (
              <div className="rounded-xl border border-zinc-700 bg-zinc-800/50 px-3 py-2">
                <p className="text-xs text-zinc-400">
                  Equipment total: <span className="font-semibold text-white">{formatPrice(equipmentTotal)}</span>
                  <span className="ml-1 text-zinc-500">(charged separately at venue)</span>
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Payment Method */}
      <div>
        <h2 className="mb-3 font-semibold text-white">Payment Method</h2>
        <PaymentSelector selected={paymentMethod} onSelect={(m) => setPaymentMethod(m)} gateway={gateway} />
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

      {equipmentTotal > 0 && (
        <p className="text-center text-xs text-zinc-500">
          * Equipment rental ({formatPrice(equipmentTotal)}) will be recorded separately
        </p>
      )}
    </div>
  );
}
