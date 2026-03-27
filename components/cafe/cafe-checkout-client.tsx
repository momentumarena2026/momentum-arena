"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCafeCart } from "@/lib/cafe-cart-context";
import { formatPrice } from "@/lib/pricing";
import { createCafeOrder } from "@/actions/cafe-orders";
import { DiscountInput } from "@/components/booking/discount-input";
import { submitCafeOrderUtr } from "@/actions/upi-payment";
import { CheckoutAuth } from "@/components/checkout-auth";
import { UpiQrCheckout } from "@/components/payment/upi-qr-checkout";

type PaymentMethod = "RAZORPAY" | "UPI_QR" | "CASH";

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, callback: () => void) => void;
    };
  }
}

export function CafeCheckoutClient({ isLoggedIn: initialLoggedIn }: { isLoggedIn?: boolean }) {
  const router = useRouter();
  const { data: session } = useSession();
  const isLoggedIn = initialLoggedIn || !!session?.user;
  const { items, totalAmount, clearCart } = useCafeCart();
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("UPI_QR");
  const [showAuth, setShowAuth] = useState(false);
  const [note, setNote] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState<{
    code: string;
    discount: number;
  } | null>(null);
  const [couponError, setCouponError] = useState("");
  const [tableNumber, setTableNumber] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null);

  const finalAmount = appliedCoupon
    ? Math.max(0, totalAmount - appliedCoupon.discount)
    : totalAmount;

  async function handleApplyCoupon() {
    if (!couponCode.trim()) return;
    setCouponLoading(true);
    setCouponError("");

    try {
      const categories = items.map((i) => i.category);
      const result = await validateCoupon(couponCode.trim(), {
        scope: "CAFE",
        amount: totalAmount,
        categories,
      });

      if (result.valid && result.discountAmount) {
        setAppliedCoupon({
          code: couponCode.trim().toUpperCase(),
          discount: result.discountAmount,
        });
        setCouponError("");
      } else {
        setCouponError(result.error || "Invalid coupon");
        setAppliedCoupon(null);
      }
    } catch {
      setCouponError("Failed to validate coupon");
    } finally {
      setCouponLoading(false);
    }
  }

  async function loadRazorpayScript(): Promise<boolean> {
    if (window.Razorpay) return true;
    return new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  }

  async function handlePlaceOrder() {
    if (items.length === 0) return;

    // If Razorpay selected and not logged in, show inline auth
    if (paymentMethod === "RAZORPAY" && !isLoggedIn && !session?.user) {
      setShowAuth(true);
      return;
    }

    setLoading(true);
    setError("");
    setShowAuth(false);

    try {
      // Create the order
      const result = await createCafeOrder({
        items: items.map((i) => ({
          cafeItemId: i.itemId,
          quantity: i.quantity,
        })),
        paymentMethod,
        discountCode: appliedCoupon?.code,
        note: note.trim() || undefined,
        guestName: !isLoggedIn ? guestName.trim() || undefined : undefined,
        guestPhone: !isLoggedIn ? guestPhone.trim() || undefined : undefined,
        tableNumber: tableNumber || undefined,
      });

      if (!result.success || !result.orderId) {
        setError(result.error || "Failed to create order");
        setLoading(false);
        return;
      }

      if (paymentMethod === "RAZORPAY") {
        // Create Razorpay order
        const rpRes = await fetch("/api/razorpay/cafe-create-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: result.orderId }),
        });

        if (!rpRes.ok) {
          const rpError = await rpRes.json();
          setError(rpError.error || "Failed to create payment");
          setLoading(false);
          return;
        }

        const rpData = await rpRes.json();

        // Load Razorpay SDK
        const loaded = await loadRazorpayScript();
        if (!loaded) {
          setError("Failed to load payment gateway");
          setLoading(false);
          return;
        }

        // Open Razorpay modal
        const razorpay = new window.Razorpay({
          key: rpData.keyId,
          amount: rpData.amount,
          currency: rpData.currency || "INR",
          name: "Momentum Arena",
          description: `Cafe Order ${result.orderNumber}`,
          order_id: rpData.orderId,
          handler: async function (response: {
            razorpay_payment_id: string;
            razorpay_order_id: string;
            razorpay_signature: string;
          }) {
            // Verify payment
            const verifyRes = await fetch("/api/razorpay/cafe-verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                orderId: result.orderId,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpayOrderId: response.razorpay_order_id,
                razorpaySignature: response.razorpay_signature,
              }),
            });

            if (verifyRes.ok) {
              clearCart();
              router.push(`/cafe/confirmation/${result.orderId}`);
            } else {
              setError("Payment verification failed. Please contact support.");
              setLoading(false);
            }
          },
          theme: { color: "#059669" },
        });

        razorpay.on("payment.failed", function () {
          setError("Payment failed. Please try again.");
          setLoading(false);
        });

        razorpay.open();
        return; // Don't set loading false, Razorpay modal is open
      }

      // For UPI_QR, show QR for UTR entry
      if (paymentMethod === "UPI_QR") {
        setCreatedOrderId(result.orderId);
        setShowQr(true);
        setLoading(false);
        return;
      }

      // For CASH, order is created directly
      clearCart();
      router.push(`/cafe/confirmation/${result.orderId}`);
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  // Show UPI QR with UTR entry after order creation
  if (showQr && createdOrderId) {
    return (
      <div className="min-h-screen bg-black max-w-2xl mx-auto py-6 px-4">
        <h1 className="text-2xl font-bold text-white mb-6">Complete Payment</h1>
        <UpiQrCheckout
          amount={finalAmount}
          onUtrSubmitted={async (utr: string) => {
            const result = await submitCafeOrderUtr(createdOrderId, utr);
            if (result.success) {
              clearCart();
              router.push(`/cafe/confirmation/${createdOrderId}`);
            } else {
              setError(result.error || "Failed to submit UTR");
              setShowQr(false);
            }
          }}
        />
        {error && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-center text-sm text-red-400">
            {error}
          </div>
        )}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-black max-w-2xl mx-auto text-center py-20 px-4">
        <div className="text-5xl mb-4">🛒</div>
        <h2 className="text-xl font-bold text-white mb-2">Cart is Empty</h2>
        <p className="text-zinc-400 mb-6">
          Add some items from the menu before checking out.
        </p>
        <button
          onClick={() => router.push("/cafe")}
          className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-6 py-2.5 rounded-lg transition-colors"
        >
          Browse Menu
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-white mb-6">Checkout</h1>

      {/* Guest Info (if not logged in) */}
      {!isLoggedIn && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-4">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            Your Details (Optional)
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="Your name"
              className="rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-600"
            />
            <input
              type="tel"
              value={guestPhone}
              onChange={(e) => setGuestPhone(e.target.value)}
              placeholder="Phone number"
              className="rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-600"
            />
          </div>
          <p className="text-xs text-zinc-500 mt-2">For order reference only. No account required.</p>
        </div>
      )}

      {/* Table Number (optional) */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-4">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Dine-In Table (Optional)
        </h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTableNumber(null)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tableNumber === null
                ? "bg-amber-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            }`}
          >
            Takeaway
          </button>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((num) => (
            <button
              key={num}
              type="button"
              onClick={() => setTableNumber(num)}
              className={`w-10 h-10 rounded-lg text-sm font-bold transition-colors ${
                tableNumber === num
                  ? "bg-amber-600 text-white"
                  : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
              }`}
            >
              {num}
            </button>
          ))}
        </div>
      </div>

      {/* Order Summary */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-4">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Order Summary
        </h2>
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.itemId} className="flex justify-between text-sm">
              <div className="flex items-center gap-2 text-white">
                <span
                  className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                    item.isVeg ? "bg-green-500" : "bg-red-500"
                  }`}
                />
                <span>
                  {item.name} x{item.quantity}
                </span>
              </div>
              <span className="text-white">
                {formatPrice(item.price * item.quantity)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Coupon */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-4">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Coupon Code
        </h2>
        <DiscountInput
          bookingAmount={totalAmount}
          scope="CAFE"
          disabled={!!appliedCoupon}
          disabledMessage={appliedCoupon ? `${appliedCoupon.code} — ${formatPrice(appliedCoupon.discount)} off` : undefined}
          onDiscountApplied={(discountAmt, _newTotal, code) => {
            setAppliedCoupon({ code, discount: discountAmt });
          }}
        />
      </div>

      {/* Payment Method */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-4">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Payment Method
        </h2>
        <div className="space-y-2">
          {(
            [
              { value: "RAZORPAY", label: "Pay Online (UPI/Card)", icon: "💳" },
              { value: "UPI_QR", label: "UPI QR at Counter", icon: "📱" },
              { value: "CASH", label: "Cash at Counter", icon: "💵" },
            ] as const
          ).map((method) => (
            <label
              key={method.value}
              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                paymentMethod === method.value
                  ? "border-emerald-500 bg-emerald-900/20"
                  : "border-zinc-700 hover:border-zinc-600"
              }`}
            >
              <input
                type="radio"
                name="paymentMethod"
                value={method.value}
                checked={paymentMethod === method.value}
                onChange={() => setPaymentMethod(method.value)}
                className="sr-only"
              />
              <span className="text-lg">{method.icon}</span>
              <span className="text-white text-sm font-medium">
                {method.label}
              </span>
              {paymentMethod === method.value && (
                <svg
                  className="w-5 h-5 text-emerald-500 ml-auto"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </label>
          ))}
        </div>
      </div>

      {/* Note */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-4">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Special Instructions (Optional)
        </h2>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Any special requests..."
          rows={2}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500 resize-none"
        />
      </div>

      {/* Totals */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-4">
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-zinc-400">Subtotal</span>
            <span className="text-white">{formatPrice(totalAmount)}</span>
          </div>
          {appliedCoupon && (
            <div className="flex justify-between text-sm">
              <span className="text-emerald-400">Discount</span>
              <span className="text-emerald-400">
                -{formatPrice(appliedCoupon.discount)}
              </span>
            </div>
          )}
          <div className="flex justify-between text-lg font-bold pt-2 border-t border-zinc-800">
            <span className="text-white">Total</span>
            <span className="text-white">{formatPrice(finalAmount)}</span>
          </div>
          <p className="text-zinc-600 text-xs">Prices inclusive of GST</p>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-900/30 border border-red-800 text-red-400 text-sm rounded-lg p-3 mb-4">
          {error}
        </div>
      )}

      {/* Inline auth for Razorpay guests */}
      {showAuth && (
        <CheckoutAuth onAuthenticated={() => { setShowAuth(false); handlePlaceOrder(); }} />
      )}

      {/* Place Order */}
      {!showAuth && (
        <button
          onClick={handlePlaceOrder}
          disabled={loading}
          className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-4 rounded-xl text-lg transition-colors"
        >
          {loading
            ? "Processing..."
            : `Place Order - ${formatPrice(finalAmount)}`}
        </button>
      )}

      <button
        onClick={() => router.push("/cafe")}
        className="w-full text-zinc-400 hover:text-white text-sm py-3 transition-colors"
      >
        Back to Menu
      </button>
    </div>
  );
}
