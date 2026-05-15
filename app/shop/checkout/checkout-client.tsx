"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, Loader2, QrCode, Wallet } from "lucide-react";
import { formatPrice } from "@/lib/pricing";
import { placeCustomerOrder } from "@/actions/shop-order";
import type { CartSnapshot } from "@/lib/cart";

type PaymentMethod = "RAZORPAY" | "UPI_QR" | "CASH";

interface Props {
  cart: CartSnapshot;
  gateway: "PHONEPE" | "RAZORPAY";
  onlineEnabled: boolean;
  upiQrEnabled: boolean;
  user: { name: string | null; email: string | null; phone: string | null };
}

// Razorpay's global is augmented in other parts of the app with a
// looser `Record<string, unknown>` signature. We rely on that and
// pass our options dict directly — typings live with the call site.
interface RazorpayHandlerResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

/**
 * Customer checkout client. Renders order summary + payment method
 * tiles, then dispatches to the chosen flow:
 *   - RAZORPAY: place PENDING order → init Razorpay → verify on
 *     success → redirect to /shop/orders/[id].
 *   - UPI_QR: place PENDING order → redirect to order detail page
 *     where the QR + UTR entry lives.
 *   - CASH: place PENDING order → redirect to order detail with
 *     "Pay & collect at venue" copy.
 *
 * We don't have an advance-payment mode for shop (the booking flow
 * does because slot reservations are time-sensitive; an inventory
 * sale doesn't have that asymmetry).
 */
export function CheckoutClient({
  cart,
  gateway,
  onlineEnabled,
  upiQrEnabled,
  user,
}: Props) {
  const router = useRouter();
  const initialMethod: PaymentMethod = onlineEnabled
    ? "RAZORPAY"
    : upiQrEnabled
      ? "UPI_QR"
      : "CASH";
  const [method, setMethod] = useState<PaymentMethod>(initialMethod);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const totalRupees = Math.round(cart.totalPaise / 100);

  async function loadRazorpayScript(): Promise<boolean> {
    if (typeof window === "undefined") return false;
    if (window.Razorpay) return true;
    return new Promise<boolean>((resolve) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  }

  async function handleOnlinePayment(orderId: string) {
    const scriptOk = await loadRazorpayScript();
    if (!scriptOk) {
      setError("Could not load Razorpay. Try again.");
      return;
    }
    const res = await fetch("/api/shop/razorpay/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Couldn't initiate payment");
      return;
    }

    const rzp = new window.Razorpay({
      key: data.keyId,
      amount: data.amount * 100,
      currency: data.currency,
      name: "Momentum Arena",
      description: `Shop order #${orderId.slice(-6).toUpperCase()}`,
      order_id: data.razorpayOrderId,
      handler: async (response: RazorpayHandlerResponse) => {
        try {
          const verifyRes = await fetch("/api/shop/razorpay/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              orderId,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpayOrderId: response.razorpay_order_id,
              razorpaySignature: response.razorpay_signature,
            }),
          });
          const verifyData = await verifyRes.json();
          if (!verifyRes.ok) {
            setError(verifyData.error ?? "Verification failed");
            return;
          }
          router.push(`/shop/orders/${orderId}`);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Verification failed");
        }
      },
      prefill: {
        name: user.name ?? undefined,
        email: user.email ?? undefined,
        contact: user.phone ?? undefined,
      },
      theme: { color: "#10b981" },
      modal: {
        ondismiss: () => {
          setProcessing(false);
        },
      },
    });
    rzp.open();
  }

  function handlePlaceOrder() {
    setError(null);
    setProcessing(true);
    startTransition(async () => {
      const res = await placeCustomerOrder(method);
      if (!res.success || !res.orderId) {
        setError(res.error ?? "Order creation failed");
        setProcessing(false);
        return;
      }
      if (method === "RAZORPAY") {
        await handleOnlinePayment(res.orderId);
      } else {
        // UPI QR or Cash — redirect to the order detail page which
        // shows the QR + UTR form or the "collect at venue" notice.
        router.push(`/shop/orders/${res.orderId}`);
      }
    });
  }

  const methodTiles: Array<{
    id: PaymentMethod;
    name: string;
    description: string;
    icon: typeof CreditCard;
    enabled: boolean;
  }> = [
    {
      id: "RAZORPAY",
      name: "Pay online",
      description:
        gateway === "PHONEPE"
          ? "UPI, Cards, Netbanking — instant confirmation"
          : "Cards, UPI, Netbanking — instant confirmation",
      icon: CreditCard,
      enabled: onlineEnabled,
    },
    {
      id: "UPI_QR",
      name: "UPI QR code",
      description: "Scan with any UPI app, share UTR after paying",
      icon: QrCode,
      enabled: upiQrEnabled,
    },
    {
      id: "CASH",
      name: "Pay at venue",
      description: "Pay in cash when you collect the order",
      icon: Wallet,
      enabled: true,
    },
  ];

  return (
    <div className="mt-6 space-y-6">
      {/* Order summary */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Your order
        </h2>
        <ul className="space-y-2">
          {cart.lines
            .filter((l) => !l.unavailable)
            .map((line) => (
              <li
                key={line.productId}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-zinc-200">
                  {line.name} × {line.quantity}
                </span>
                <span className="font-mono text-zinc-300">
                  {formatPrice(
                    Math.round((line.pricePaise * line.quantity) / 100),
                  )}
                </span>
              </li>
            ))}
        </ul>
        <div className="mt-3 flex items-center justify-between border-t border-zinc-800 pt-3">
          <span className="text-sm font-semibold text-white">Total</span>
          <span className="text-lg font-bold text-emerald-300">
            {formatPrice(totalRupees)}
          </span>
        </div>
      </section>

      {/* Payment method */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Payment method
        </h2>
        {methodTiles
          .filter((t) => t.enabled)
          .map((tile) => {
            const isSelected = method === tile.id;
            const Icon = tile.icon;
            return (
              <button
                key={tile.id}
                type="button"
                onClick={() => setMethod(tile.id)}
                className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left transition ${
                  isSelected
                    ? "border-emerald-400 bg-emerald-500/10 ring-1 ring-emerald-400/40"
                    : "border-zinc-800 bg-zinc-900 hover:border-zinc-600"
                }`}
              >
                <div
                  className={`rounded-lg p-2 ${
                    isSelected ? "bg-emerald-500/15" : "bg-zinc-800"
                  }`}
                >
                  <Icon
                    className={`h-5 w-5 ${
                      isSelected ? "text-emerald-300" : "text-zinc-400"
                    }`}
                  />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-white">{tile.name}</p>
                  <p className="text-xs text-zinc-400">{tile.description}</p>
                </div>
                <div
                  className={`h-4 w-4 rounded-full border-2 ${
                    isSelected
                      ? "border-emerald-400 bg-emerald-400"
                      : "border-zinc-600"
                  }`}
                />
              </button>
            );
          })}
      </section>

      {error ? (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={handlePlaceOrder}
        disabled={processing}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-3 text-base font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
      >
        {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {method === "RAZORPAY"
          ? `Pay ${formatPrice(totalRupees)}`
          : method === "UPI_QR"
            ? "Place order — show QR"
            : "Place order — pay at venue"}
      </button>
    </div>
  );
}
