"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/lib/cart-context";
import { formatPrice } from "@/lib/pricing";
import { formatHour } from "@/lib/court-config";
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Trash2,
  ArrowLeft,
  ShoppingBag,
} from "lucide-react";
import { toast } from "sonner";

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => {
      open: () => void;
    };
  }
}

interface LockStatus {
  itemId: string;
  status: "locked" | "conflict" | "pending";
  bookingId?: string;
  lockExpiresAt?: string;
  error?: string;
  conflictingHours?: number[];
}

function CountdownTimer({
  expiresAt,
  onExpired,
}: {
  expiresAt: string;
  onExpired: () => void;
}) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const update = () => {
      const diff = Math.max(
        0,
        Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)
      );
      setRemaining(diff);
      if (diff <= 0) onExpired();
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [expiresAt, onExpired]);

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const isLow = remaining < 60;

  return (
    <span
      className={`flex items-center gap-1 text-xs font-mono ${
        isLow ? "text-red-400" : "text-yellow-400"
      }`}
    >
      <Clock className="h-3 w-3" />
      {mins}:{secs.toString().padStart(2, "0")}
    </span>
  );
}

export function CartCheckoutClient({
  userName,
  userEmail,
  userPhone,
}: {
  userName: string;
  userEmail: string;
  userPhone: string;
}) {
  const router = useRouter();
  const { items, removeItem, clearCart } = useCart();
  const [lockStatuses, setLockStatuses] = useState<LockStatus[]>([]);
  const [locking, setLocking] = useState(false);
  const [paying, setPaying] = useState(false);
  const [locksDone, setLocksDone] = useState(false);

  const lockedItems = lockStatuses.filter((s) => s.status === "locked");
  const conflictItems = lockStatuses.filter((s) => s.status === "conflict");
  const allLocked = locksDone && conflictItems.length === 0 && lockedItems.length > 0;

  const lockedBookingIds = lockedItems
    .map((s) => s.bookingId)
    .filter(Boolean) as string[];

  const lockedTotal = items
    .filter((item) => lockedItems.some((s) => s.itemId === item.id))
    .reduce((sum, item) => sum + item.totalAmount, 0);

  // Lock all cart items on mount
  const performBatchLock = useCallback(async () => {
    if (items.length === 0) return;
    setLocking(true);
    setLocksDone(false);

    try {
      const res = await fetch("/api/booking/batch-lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map((item) => ({
            itemId: item.id,
            configId: item.configId,
            date: item.date,
            slots: item.slots,
          })),
        }),
      });

      const data = await res.json();

      if (data.results) {
        setLockStatuses(data.results);
        if (data.conflictCount > 0) {
          toast.error(
            `${data.conflictCount} item(s) have conflicts. Remove them to proceed.`
          );
        }
      } else {
        toast.error(data.error || "Failed to lock slots");
      }
    } catch {
      toast.error("Failed to lock slots");
    } finally {
      setLocking(false);
      setLocksDone(true);
    }
  }, [items]);

  useEffect(() => {
    performBatchLock();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLockExpired = useCallback(
    (itemId: string) => {
      setLockStatuses((prev) =>
        prev.map((s) =>
          s.itemId === itemId ? { ...s, status: "conflict", error: "Lock expired" } : s
        )
      );
    },
    []
  );

  const handleRemoveConflict = (itemId: string) => {
    removeItem(itemId);
    setLockStatuses((prev) => prev.filter((s) => s.itemId !== itemId));
  };

  // Load Razorpay script
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    document.body.appendChild(script);
    return () => {
      document.body.removeChild(script);
    };
  }, []);

  const handlePayment = async () => {
    if (!allLocked || lockedBookingIds.length === 0) return;
    setPaying(true);

    try {
      // Create combined Razorpay order
      const orderRes = await fetch("/api/razorpay/create-cart-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingIds: lockedBookingIds }),
      });

      const orderData = await orderRes.json();
      if (!orderData.orderId) {
        toast.error(orderData.error || "Failed to create payment order");
        setPaying(false);
        return;
      }

      // Open Razorpay checkout
      const options = {
        key: orderData.keyId,
        amount: orderData.amount,
        currency: orderData.currency,
        name: "Momentum Arena",
        description: `Booking ${lockedBookingIds.length} court(s)`,
        order_id: orderData.orderId,
        prefill: {
          name: userName,
          email: userEmail,
          contact: userPhone,
        },
        theme: { color: "#10b981" },
        handler: async (response: {
          razorpay_payment_id: string;
          razorpay_order_id: string;
          razorpay_signature: string;
        }) => {
          // Verify payment
          const verifyRes = await fetch("/api/razorpay/verify-cart", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              bookingIds: lockedBookingIds,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpayOrderId: response.razorpay_order_id,
              razorpaySignature: response.razorpay_signature,
            }),
          });

          const verifyData = await verifyRes.json();
          if (verifyData.success) {
            clearCart();
            toast.success("Payment successful! All bookings confirmed.");
            // Navigate to first booking's confirmation
            router.push(
              `/book/confirmation/${lockedBookingIds[0]}`
            );
          } else {
            toast.error(verifyData.error || "Payment verification failed");
          }
          setPaying(false);
        },
        modal: {
          ondismiss: () => setPaying(false),
        },
      };

      const rzp = new window.Razorpay(options);
      rzp.open();
    } catch {
      toast.error("Payment failed");
      setPaying(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="text-center py-16 space-y-4">
        <ShoppingBag className="h-12 w-12 mx-auto text-zinc-600" />
        <p className="text-zinc-400">Your Play Cart is empty</p>
        <button
          onClick={() => router.push("/book")}
          className="text-sm text-emerald-400 hover:text-emerald-300"
        >
          Browse Courts
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <button
          onClick={() => router.back()}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <h1 className="text-2xl font-bold text-white">Play Cart Checkout</h1>
        <p className="mt-1 text-sm text-zinc-400">
          {items.length} item{items.length !== 1 ? "s" : ""} in cart
        </p>
      </div>

      {/* Locking state */}
      {locking && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-emerald-400 mx-auto" />
          <p className="mt-2 text-sm text-zinc-400">
            Locking your slots...
          </p>
        </div>
      )}

      {/* Cart items with lock status */}
      {locksDone && (
        <div className="space-y-3">
          {items.map((item) => {
            const lockStatus = lockStatuses.find((s) => s.itemId === item.id);
            const isLocked = lockStatus?.status === "locked";
            const isConflict = lockStatus?.status === "conflict";

            return (
              <div
                key={item.id}
                className={`rounded-xl border p-4 ${
                  isConflict
                    ? "border-red-500/30 bg-red-500/5"
                    : isLocked
                    ? "border-emerald-500/30 bg-zinc-900"
                    : "border-zinc-800 bg-zinc-900"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      {isLocked && (
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      )}
                      {isConflict && (
                        <AlertTriangle className="h-4 w-4 text-red-400" />
                      )}
                      <p className="font-medium text-white">
                        {item.sportName} — {item.courtSize}
                      </p>
                    </div>
                    <p className="text-xs text-zinc-400 mt-1">
                      {item.courtLabel} |{" "}
                      {new Date(item.date + "T00:00:00").toLocaleDateString(
                        "en-IN",
                        { weekday: "short", day: "numeric", month: "short" }
                      )}
                    </p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {item.slots.map((h) => formatHour(h)).join(", ")}
                    </p>

                    {isConflict && (
                      <p className="text-xs text-red-400 mt-2">
                        {lockStatus?.error || "Slots no longer available"}
                        {lockStatus?.conflictingHours && (
                          <span>
                            {" "}
                            — Conflicts:{" "}
                            {lockStatus.conflictingHours
                              .map((h) => formatHour(h))
                              .join(", ")}
                          </span>
                        )}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <span
                      className={`text-sm font-semibold ${
                        isConflict ? "text-red-400 line-through" : "text-emerald-400"
                      }`}
                    >
                      {formatPrice(item.totalAmount)}
                    </span>

                    {isLocked && lockStatus?.lockExpiresAt && (
                      <CountdownTimer
                        expiresAt={lockStatus.lockExpiresAt}
                        onExpired={() => handleLockExpired(item.id)}
                      />
                    )}

                    {isConflict && (
                      <button
                        onClick={() => handleRemoveConflict(item.id)}
                        className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors"
                      >
                        <Trash2 className="h-3 w-3" />
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Payment section */}
      {locksDone && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-400">
              {lockedItems.length} item{lockedItems.length !== 1 ? "s" : ""}{" "}
              ready to pay
            </span>
            <span className="text-lg font-bold text-white">
              {formatPrice(lockedTotal)}
            </span>
          </div>

          {conflictItems.length > 0 && (
            <p className="text-xs text-yellow-400">
              Remove conflicted items to proceed with payment.
            </p>
          )}

          <button
            onClick={handlePayment}
            disabled={!allLocked || paying}
            className="w-full rounded-xl bg-emerald-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {paying ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              `Pay ${formatPrice(lockedTotal)}`
            )}
          </button>
        </div>
      )}
    </div>
  );
}
