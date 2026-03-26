"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCafeCart } from "@/lib/cafe-cart-context";
import { formatPrice } from "@/lib/pricing";
import { validateCafeCoupon } from "@/actions/cafe-orders";

export function CafeCartDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { items, updateQuantity, removeItem, clearCart, totalAmount } =
    useCafeCart();
  const [couponCode, setCouponCode] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState<{
    code: string;
    discount: number;
  } | null>(null);
  const [couponError, setCouponError] = useState("");

  // Reset coupon when cart changes
  useEffect(() => {
    if (appliedCoupon) {
      setAppliedCoupon(null);
      setCouponCode("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  async function handleApplyCoupon() {
    if (!couponCode.trim()) return;
    setCouponLoading(true);
    setCouponError("");

    try {
      const categories = items.map((i) => i.category);
      const result = await validateCafeCoupon(
        couponCode.trim(),
        totalAmount,
        categories
      );

      if (result.valid && result.discount) {
        setAppliedCoupon({ code: couponCode.trim().toUpperCase(), discount: result.discount });
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

  function removeCoupon() {
    setAppliedCoupon(null);
    setCouponCode("");
    setCouponError("");
  }

  const finalAmount = appliedCoupon
    ? Math.max(0, totalAmount - appliedCoupon.discount)
    : totalAmount;

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-50"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-zinc-900 border-l border-zinc-800 z-50 flex flex-col animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h2 className="text-lg font-bold text-white">Your Cart</h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-1 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {items.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6">
            <div className="text-5xl mb-4">🛒</div>
            <p className="text-zinc-400 text-lg font-medium">Your cart is empty</p>
            <p className="text-zinc-600 text-sm mt-1">Add items from the menu</p>
            <button
              onClick={onClose}
              className="mt-6 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-6 py-2.5 rounded-lg transition-colors"
            >
              Browse Menu
            </button>
          </div>
        ) : (
          <>
            {/* Cart items */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {items.map((item) => (
                <div
                  key={item.itemId}
                  className="bg-zinc-800/50 rounded-lg p-3 flex items-start gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block w-3 h-3 border-2 rounded-sm flex-shrink-0 ${
                          item.isVeg ? "border-green-500" : "border-red-500"
                        } flex items-center justify-center`}
                      >
                        <span
                          className={`block w-1 h-1 rounded-full ${
                            item.isVeg ? "bg-green-500" : "bg-red-500"
                          }`}
                        />
                      </span>
                      <span className="text-white text-sm font-medium truncate">
                        {item.name}
                      </span>
                    </div>
                    <p className="text-zinc-400 text-xs mt-1">
                      {formatPrice(item.price)} each
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex items-center bg-zinc-700 rounded-lg">
                      <button
                        onClick={() =>
                          updateQuantity(item.itemId, item.quantity - 1)
                        }
                        className="text-white px-2.5 py-1 hover:bg-zinc-600 rounded-l-lg text-sm font-bold transition-colors"
                      >
                        -
                      </button>
                      <span className="text-white text-sm font-bold min-w-[24px] text-center">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() =>
                          updateQuantity(item.itemId, item.quantity + 1)
                        }
                        className="text-white px-2.5 py-1 hover:bg-zinc-600 rounded-r-lg text-sm font-bold transition-colors"
                      >
                        +
                      </button>
                    </div>

                    <span className="text-white text-sm font-bold min-w-[60px] text-right">
                      {formatPrice(item.price * item.quantity)}
                    </span>

                    <button
                      onClick={() => removeItem(item.itemId)}
                      className="text-zinc-500 hover:text-red-400 p-1 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}

              {/* Clear cart */}
              <button
                onClick={clearCart}
                className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
              >
                Clear Cart
              </button>
            </div>

            {/* Footer */}
            <div className="border-t border-zinc-800 p-4 space-y-3">
              {/* Coupon */}
              {!appliedCoupon ? (
                <div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={couponCode}
                      onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                      placeholder="Enter coupon code"
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500"
                    />
                    <button
                      onClick={handleApplyCoupon}
                      disabled={couponLoading || !couponCode.trim()}
                      className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                    >
                      {couponLoading ? "..." : "Apply"}
                    </button>
                  </div>
                  {couponError && (
                    <p className="text-red-400 text-xs mt-1">{couponError}</p>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-between bg-emerald-900/30 border border-emerald-800 rounded-lg px-3 py-2">
                  <div>
                    <span className="text-emerald-400 text-sm font-medium">
                      {appliedCoupon.code}
                    </span>
                    <span className="text-emerald-400/70 text-xs ml-2">
                      -{formatPrice(appliedCoupon.discount)}
                    </span>
                  </div>
                  <button
                    onClick={removeCoupon}
                    className="text-zinc-400 hover:text-red-400 text-xs transition-colors"
                  >
                    Remove
                  </button>
                </div>
              )}

              {/* Totals */}
              <div className="space-y-1">
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
                <div className="flex justify-between text-base font-bold pt-1 border-t border-zinc-800">
                  <span className="text-white">Total</span>
                  <span className="text-white">{formatPrice(finalAmount)}</span>
                </div>
              </div>

              {/* Checkout button */}
              <button
                onClick={() => {
                  onClose();
                  router.push("/cafe/checkout");
                }}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-lg transition-colors"
              >
                Proceed to Checkout
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
