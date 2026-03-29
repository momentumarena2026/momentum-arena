"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CountdownTimer } from "@/components/booking/countdown-timer";
import { PaymentSelector, type PaymentMethodType } from "@/components/payment/payment-selector";
import { AdvancePaymentSelector, type AdvancePaymentMethod } from "@/components/payment/advance-payment-selector";
import { DiscountInput } from "@/components/booking/discount-input";
import { UpiQrCheckout } from "@/components/payment/upi-qr-checkout";
import { formatPrice } from "@/lib/pricing";
import { validateCoupon, applyCoupon } from "@/actions/coupon-validation";
import { selectCashPayment } from "@/actions/booking";
import { submitBookingUtr } from "@/actions/upi-payment";
import { getAvailableEquipment, addEquipmentToBooking } from "@/actions/equipment";
import { getWallet, payBookingWithWallet } from "@/actions/wallet";
import { createRecurringBooking } from "@/actions/recurring-booking";
import { Loader2, Sparkles, Package, Wallet, RefreshCw, Calendar, CheckCircle, Plus, Minus } from "lucide-react";

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
}

type WalletPaymentMethodType = PaymentMethodType | "wallet";

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
}: CheckoutClientProps) {
  const router = useRouter();
  const [paymentMethod, setPaymentMethod] = useState<WalletPaymentMethodType>("upi_qr");
  const [advanceMethod, setAdvanceMethod] = useState<AdvancePaymentMethod>("razorpay");
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

  // Wallet state
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [walletLoading, setWalletLoading] = useState(true);

  // Recurring confirmation state
  const [recurringResult, setRecurringResult] = useState<{ created: boolean; bookingsCreated?: number; id?: string } | null>(null);

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

  // Fetch wallet balance
  useEffect(() => {
    getWallet().then((result) => {
      if (result.success && result.wallet) {
        setWalletBalance(result.wallet.balancePaise);
      } else {
        setWalletBalance(0);
      }
    }).finally(() => setWalletLoading(false));
  }, []);

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
  const advanceAmount = Math.ceil(effectiveAmount * 0.2);
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

  const handleWalletPayment = async () => {
    const totalToPay = effectiveAmount;
    if (walletBalance === null || walletBalance < totalToPay) {
      setError(`Insufficient wallet balance. Available: ${formatPrice(walletBalance || 0)}`);
      return;
    }

    const result = await payBookingWithWallet(bookingId);

    if (!result.success) {
      setError(result.error || "Wallet payment failed");
      return;
    }

    await addEquipmentAfterBooking(bookingId);
    await handleRecurringAfterPayment();
    router.push(`/book/confirmation/${bookingId}`);
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

  const handlePayment = async () => {
    setProcessing(true);
    setError(null);

    try {
      if (paymentMethod === "wallet") {
        await handleWalletPayment();
        return;
      }

      if (paymentMethod === "razorpay") {
        // Full payment via Razorpay
        const res = await fetch("/api/razorpay/create-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookingId, offerId: razorpayOfferId }),
        });
        const data = await res.json();
        if (!res.ok) { setError(data.error || "Failed"); setProcessing(false); return; }

        const options = {
          key: data.keyId,
          amount: data.amount,
          currency: data.currency,
          name: "Momentum Arena",
          description: `Booking #${bookingId.slice(-8)}`,
          order_id: data.orderId,
          ...(razorpayOfferId ? { offer_id: razorpayOfferId } : {}),
          handler: async function (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) {
            const verifyRes = await fetch("/api/razorpay/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ bookingId, razorpayPaymentId: response.razorpay_payment_id, razorpayOrderId: response.razorpay_order_id, razorpaySignature: response.razorpay_signature }),
            });
            if (verifyRes.ok) {
              await addEquipmentAfterBooking(bookingId);
              await handleRecurringAfterPayment();
              router.push(`/book/confirmation/${bookingId}`);
            } else {
              setError("Payment verification failed");
            }
          },
          prefill: { name: userName, email: userEmail, contact: userPhone },
          theme: { color: "#10b981" },
        };

        const razorpay = new (window as unknown as { Razorpay: new (opts: typeof options) => { open: () => void } }).Razorpay(options);
        razorpay.open();
      } else if (paymentMethod === "upi_qr") {
        // Show QR with UTR entry — create pending UPI payment first
        const { selectUpiPayment } = await import("@/actions/booking");
        const result = await selectUpiPayment(bookingId);
        if (!result.success) { setError(result.error || "Failed"); setProcessing(false); return; }
        setShowUpiQr(true);
      } else if (paymentMethod === "cash") {
        // Cash requires 20% advance
        if (advanceMethod === "razorpay") {
          const res = await fetch("/api/razorpay/create-order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bookingId, isAdvance: true }),
          });
          const data = await res.json();
          if (!res.ok) { setError(data.error || "Failed"); setProcessing(false); return; }

          const options = {
            key: data.keyId,
            amount: data.amount,
            currency: data.currency,
            name: "Momentum Arena",
            description: `Advance for Booking #${bookingId.slice(-8)}`,
            order_id: data.orderId,
            handler: async function (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) {
              const verifyRes = await fetch("/api/razorpay/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ bookingId, razorpayPaymentId: response.razorpay_payment_id, razorpayOrderId: response.razorpay_order_id, razorpaySignature: response.razorpay_signature, isAdvance: true }),
              });
              if (verifyRes.ok) {
                await addEquipmentAfterBooking(bookingId);
                router.push(`/book/confirmation/${bookingId}`);
              } else {
                setError("Advance payment verification failed");
              }
            },
            prefill: { name: userName, email: userEmail, contact: userPhone },
            theme: { color: "#10b981" },
          };

          const razorpay = new (window as unknown as { Razorpay: new (opts: typeof options) => { open: () => void } }).Razorpay(options);
          razorpay.open();
        } else {
          // UPI QR for advance
          setShowUpiQr(true);
          const result = await selectCashPayment(bookingId);
          if (!result.success) { setError(result.error || "Failed"); setShowUpiQr(false); }
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
          isAdvance={paymentMethod === "cash"}
          advanceAmount={paymentMethod === "cash" ? advanceAmount : undefined}
          onUtrSubmitted={async (utr: string) => {
            const result = await submitBookingUtr(bookingId, utr);
            if (result.success) {
              router.push(`/book/confirmation/${bookingId}`);
            } else {
              setError(result.error || "Failed to submit UTR");
              setShowUpiQr(false);
            }
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

      {/* Wallet Balance Info */}
      {!walletLoading && walletBalance !== null && walletBalance > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-emerald-400" />
            <p className="text-sm text-zinc-300">
              Wallet balance: <span className="font-semibold text-white">{formatPrice(walletBalance)}</span>
            </p>
          </div>
        </div>
      )}

      {/* Payment Method */}
      <div>
        <h2 className="mb-3 font-semibold text-white">Payment Method</h2>

        {/* Wallet Pay Option */}
        {!walletLoading && walletBalance !== null && walletBalance >= effectiveAmount && (
          <button
            onClick={() => setPaymentMethod(paymentMethod === "wallet" ? "upi_qr" : "wallet")}
            className={`mb-3 w-full flex items-center gap-3 rounded-xl border p-3.5 text-left transition-colors ${
              paymentMethod === "wallet"
                ? "border-emerald-500/40 bg-emerald-500/10"
                : "border-zinc-700 bg-zinc-800 hover:border-zinc-600"
            }`}
          >
            <div className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
              paymentMethod === "wallet" ? "border-emerald-400" : "border-zinc-500"
            }`}>
              {paymentMethod === "wallet" && <div className="h-2 w-2 rounded-full bg-emerald-400" />}
            </div>
            <Wallet className="h-4 w-4 text-emerald-400" />
            <div>
              <p className="text-sm font-medium text-white">Pay with Wallet</p>
              <p className="text-xs text-zinc-400">Balance: {formatPrice(walletBalance)}</p>
            </div>
          </button>
        )}

        {paymentMethod !== "wallet" && (
          <PaymentSelector selected={paymentMethod as PaymentMethodType} onSelect={(m) => setPaymentMethod(m)} />
        )}
      </div>

      {/* Advance Payment for Cash */}
      {paymentMethod === "cash" && (
        <AdvancePaymentSelector
          totalAmount={effectiveAmount}
          advanceAmount={advanceAmount}
          remainingAmount={remainingAmount}
          selected={advanceMethod}
          onSelect={setAdvanceMethod}
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
        ) : paymentMethod === "wallet" ? (
          `Pay ${formatPrice(effectiveAmount)} from Wallet`
        ) : paymentMethod === "razorpay" ? (
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
