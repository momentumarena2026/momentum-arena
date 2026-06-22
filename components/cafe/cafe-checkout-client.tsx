"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCafeCart } from "@/lib/cafe-cart-context";
import { formatPrice } from "@/lib/pricing";
import { createCafeOrder } from "@/actions/cafe-orders";
import { DiscountInput } from "@/components/booking/discount-input";
import { DqrCheckout } from "@/components/payment/dqr-checkout";
// UTR submission disabled — admin verifies via WhatsApp screenshot
import { CheckoutAuth } from "@/components/checkout-auth";
import { PhoneInput } from "@/components/ui/phone-input";
import {
  trackCafeCheckoutStarted,
  trackCafePaymentMethodSelected,
  trackCafeOrderPlaced,
  trackCouponApplied,
  trackError,
} from "@/lib/analytics";

// "UPI_NOW" = pay now via PhonePe Dynamic QR (auto-confirm online),
// distinct from "UPI_QR" which is the legacy pay-at-the-counter option.
type PaymentMethod = "UPI_NOW" | "ONLINE" | "UPI_QR" | "CASH";

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, callback: () => void) => void;
    };
  }
}

export function CafeCheckoutClient({ isLoggedIn: initialLoggedIn, gateway = "PHONEPE", dqrEnabled = false }: { isLoggedIn?: boolean; gateway?: "PHONEPE" | "RAZORPAY"; dqrEnabled?: boolean }) {
  const router = useRouter();
  const { data: session } = useSession();
  const isLoggedIn = initialLoggedIn || !!session?.user;
  const { items, totalAmount, clearCart } = useCafeCart();
  // UPI-first when DQR is live; otherwise the gateway stays the default
  // (cafe has no static online-UPI, so UPI-first only applies with DQR).
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    dqrEnabled ? "UPI_NOW" : "ONLINE",
  );
  const [showAuth, setShowAuth] = useState(false);
  // DQR pay-now: holds the CafePaymentIntent id once created, then
  // renders the dynamic-QR step.
  const [dqrIntentId, setDqrIntentId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<{
    code: string;
    discount: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const finalAmount = appliedCoupon
    ? Math.max(0, totalAmount - appliedCoupon.discount)
    : totalAmount;

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
    trackCafeCheckoutStarted(items.length, finalAmount);

    // Online pay-now methods (gateway + DQR) require a signed-in user.
    if (
      (paymentMethod === "ONLINE" || paymentMethod === "UPI_NOW") &&
      !isLoggedIn &&
      !session?.user
    ) {
      setShowAuth(true);
      return;
    }

    // UPI_NOW: create a CafePaymentIntent (gateway-style), then show the
    // dynamic QR. The intent is stamped PHONEPE but materialises as a
    // UPI_QR / PHONEPE_DQR payment on confirm (see lib/dqr-confirm).
    if (paymentMethod === "UPI_NOW") {
      setLoading(true);
      setError("");
      setShowAuth(false);
      try {
        const result = await createCafeOrder({
          items: items.map((i) => ({ cafeItemId: i.itemId, quantity: i.quantity })),
          paymentMethod: "PHONEPE",
          discountCode: appliedCoupon?.code,
          note: note.trim() || undefined,
          guestName: !isLoggedIn ? guestName.trim() || undefined : undefined,
          guestPhone: !isLoggedIn ? guestPhone.trim() || undefined : undefined,
        });
        if (!result.success || !result.orderId) {
          setError(result.error || "Failed to start payment");
          setLoading(false);
          return;
        }
        setDqrIntentId(result.orderId);
        setLoading(false);
      } catch {
        setError("Something went wrong. Please try again.");
        setLoading(false);
      }
      return;
    }

    const isOnlinePayment = paymentMethod === "ONLINE";

    setLoading(true);
    setError("");
    setShowAuth(false);

    try {
      // Create the order
      // Map "ONLINE" to actual gateway method for the backend
      const backendPaymentMethod = isOnlinePayment
        ? (gateway === "PHONEPE" ? "PHONEPE" : "RAZORPAY")
        : paymentMethod;

      const result = await createCafeOrder({
        items: items.map((i) => ({
          cafeItemId: i.itemId,
          quantity: i.quantity,
        })),
        paymentMethod: backendPaymentMethod,
        discountCode: appliedCoupon?.code,
        note: note.trim() || undefined,
        guestName: !isLoggedIn ? guestName.trim() || undefined : undefined,
        guestPhone: !isLoggedIn ? guestPhone.trim() || undefined : undefined,
      });

      if (!result.success || !result.orderId) {
        setError(result.error || "Failed to create order");
        setLoading(false);
        return;
      }

      if (isOnlinePayment) {
        if (gateway === "PHONEPE") {
          // PhonePe redirect flow
          const ppRes = await fetch("/api/phonepe/cafe-initiate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId: result.orderId }),
          });

          if (!ppRes.ok) {
            const ppError = await ppRes.json();
            setError(ppError.error || "Failed to initiate payment");
            setLoading(false);
            return;
          }

          const ppData = await ppRes.json();
          // Redirect to PhonePe payment page
          window.location.href = ppData.redirectUrl;
          return;
        }

        // Razorpay modal flow
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

        const loaded = await loadRazorpayScript();
        if (!loaded) {
          setError("Failed to load payment gateway");
          setLoading(false);
          return;
        }

        // Cancel-on-dismiss helper. Called when the customer
        // closes the Razorpay modal without paying, or when the
        // gateway reports payment.failed. Hits the cafe-cancel
        // endpoint which flips the order to CANCELLED so it never
        // shows up on the admin board, and rolls back the coupon
        // burn so the customer can retry with the same code.
        // Stock is not touched — PENDING_PAYMENT orders never
        // decremented inventory.
        const cancelPendingPaymentOrder = async (reason: string) => {
          try {
            await fetch("/api/razorpay/cafe-cancel", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ orderId: result.orderId, reason }),
            });
          } catch (cancelErr) {
            // Best-effort — if the cancel POST fails (network
            // hiccup) the server-side sweep cron will clean up
            // any PENDING_PAYMENT orders eventually. We don't
            // surface the error to the customer; they already
            // know payment didn't go through.
            console.error("[cafe-cancel] best-effort cancel failed", cancelErr);
          }
        };

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
            const verifyRes = await fetch("/api/razorpay/cafe-verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                // `result.orderId` is the CafePaymentIntent id on
                // the new flow; the verify endpoint materialises
                // the real CafeOrder from it.
                orderId: result.orderId,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpayOrderId: response.razorpay_order_id,
                razorpaySignature: response.razorpay_signature,
              }),
            });

            const verifyData = await verifyRes.json().catch(() => null);

            if (verifyRes.ok && verifyData?.orderId) {
              // Navigation uses the orderId returned BY THE VERIFY
              // RESPONSE — that's the real CafeOrder id (the intent
              // id we sent in doesn't address a CafeOrder).
              trackCafeOrderPlaced(verifyData.orderId, finalAmount, "RAZORPAY");
              clearCart();
              router.push(`/cafe/confirmation/${verifyData.orderId}`);
            } else {
              trackError("cafe_payment", "Payment verification failed");
              setError(
                verifyData?.error ??
                  "Payment verification failed. Please contact support.",
              );
              setLoading(false);
            }
          },
          modal: {
            // ondismiss fires when the customer closes the modal
            // without completing payment (clicks the X, taps the
            // backdrop, hits back, etc). Treat this as a hard
            // cancel — release the PENDING_PAYMENT order so the
            // admin tab stays clean.
            ondismiss: async () => {
              await cancelPendingPaymentOrder("Customer dismissed Razorpay modal");
              setError("Payment cancelled. Your order was not placed.");
              setLoading(false);
            },
          },
          theme: { color: "#059669" },
        });

        razorpay.on("payment.failed", async function () {
          await cancelPendingPaymentOrder("Razorpay reported payment.failed");
          setError("Payment failed. Please try again.");
          setLoading(false);
        });

        razorpay.open();
        return;
      }

      // UPI_QR and CASH are both "pay-at-the-counter" methods for
      // cafe — there's no QR-scan step in between. The customer
      // places the order, walks up to the counter, and pays there.
      // Going through UpiQrCheckout was a leftover from the sports
      // booking flow where the QR doubles as the UTR-entry capture.
      // For cafe we don't need that — the order's already live in
      // the kitchen and the cashier collects whatever payment the
      // customer hands them.
      trackCafeOrderPlaced(
        result.orderId!,
        finalAmount,
        paymentMethod as "CASH" | "UPI_QR",
      );
      clearCart();
      router.push(`/cafe/confirmation/${result.orderId}`);
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  // DQR pay-now step — render the dynamic QR once the intent exists.
  if (dqrIntentId) {
    return (
      <div className="min-h-screen bg-black max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-white mb-6">Scan to Pay</h1>
        <DqrCheckout
          holdId={dqrIntentId}
          amount={finalAmount}
          surface="cafe"
          onConfirmed={(orderId) => {
            clearCart();
            router.push(`/cafe/confirmation/${orderId}`);
          }}
          onCancel={() => setDqrIntentId(null)}
        />
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
            <PhoneInput
              value={guestPhone}
              onChange={setGuestPhone}
              placeholder="10-digit phone"
            />
          </div>
          <p className="text-xs text-zinc-500 mt-2">For order reference only. No account required.</p>
        </div>
      )}

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
            trackCouponApplied(code, discountAmt);
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
            dqrEnabled
              ? [
                  {
                    value: "UPI_NOW" as const,
                    label: "Pay now via UPI",
                    sub: "Recommended · no extra charge",
                    icon: "🔳",
                  },
                  {
                    value: "ONLINE" as const,
                    label: gateway === "PHONEPE" ? "PhonePe — Cards / Netbanking" : "Card / Netbanking",
                    sub: undefined,
                    icon: "💳",
                  },
                  { value: "CASH" as const, label: "Pay at Counter", sub: undefined, icon: "💵" },
                ]
              : [
                  { value: "ONLINE" as const, label: "Pay Online", sub: undefined, icon: "💳" },
                  { value: "UPI_QR" as const, label: "UPI QR at Counter", sub: undefined, icon: "🔲" },
                  { value: "CASH" as const, label: "Cash at Counter", sub: undefined, icon: "💵" },
                ]
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
                onChange={() => { setPaymentMethod(method.value); trackCafePaymentMethodSelected(method.value); }}
                className="sr-only"
              />
              <span className="text-lg">{method.icon}</span>
              <span className="flex flex-col">
                <span className="text-white text-sm font-medium">{method.label}</span>
                {method.sub && (
                  <span className="text-[11px] text-emerald-300/80">{method.sub}</span>
                )}
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

      {/* Inline auth for online payment guests */}
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
        type="button"
        onClick={() => window.history.back()}
        className="w-full text-zinc-400 hover:text-white text-sm py-3 transition-colors"
      >
        Back
      </button>
    </div>
  );
}
