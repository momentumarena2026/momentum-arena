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
import { Loader2, MapPin, Sparkles } from "lucide-react";

interface CheckoutClientProps {
  bookingId: string;
  amount: number;
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
}

export function CheckoutClient({
  bookingId,
  amount,
  sport,
  lockExpiresAt,
  userName,
  userEmail,
  userPhone,
  razorpayOfferId,
  newUserDiscount,
}: CheckoutClientProps) {
  const router = useRouter();
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodType>("upi_qr");
  const [advanceMethod, setAdvanceMethod] = useState<AdvancePaymentMethod>("razorpay");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUpiQr, setShowUpiQr] = useState(false);

  // Discount state
  const [effectiveAmount, setEffectiveAmount] = useState(amount);
  const [discountApplied, setDiscountApplied] = useState(false);
  const [discountLabel, setDiscountLabel] = useState<string | null>(null);
  const [newUserApplied, setNewUserApplied] = useState(false);

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

  const handlePayment = async () => {
    setProcessing(true);
    setError(null);

    try {
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
            if (verifyRes.ok) router.push(`/book/confirmation/${bookingId}`);
            else setError("Payment verification failed");
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
              if (verifyRes.ok) router.push(`/book/confirmation/${bookingId}`);
              else setError("Advance payment verification failed");
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

      {/* Payment Method */}
      <div>
        <h2 className="mb-3 font-semibold text-white">Payment Method</h2>
        <PaymentSelector selected={paymentMethod} onSelect={setPaymentMethod} />
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
        ) : paymentMethod === "razorpay" ? (
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
