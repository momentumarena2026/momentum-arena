"use client";

import { useCart } from "@/lib/cart-context";
import { useRouter } from "next/navigation";
import { formatPrice } from "@/lib/pricing";
import { formatHour } from "@/lib/court-config";
import { X, Trash2, ShoppingBag, ArrowRight } from "lucide-react";
import { useEffect, useCallback } from "react";

export function CartDrawer() {
  const { items, removeItem, clearCart, totalAmount, isOpen, setIsOpen } = useCart();
  const router = useRouter();

  const handleEsc = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    },
    [setIsOpen]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("keydown", handleEsc);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleEsc);
      document.body.style.overflow = "";
    };
  }, [isOpen, handleEsc]);

  if (!isOpen) return null;

  const handleCheckout = () => {
    setIsOpen(false);
    router.push("/book/cart-checkout");
  };

  return (
    <div className="fixed inset-0 z-50" onClick={() => setIsOpen(false)}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Drawer */}
      <div
        className="absolute right-0 top-0 h-full w-full max-w-md bg-zinc-950 border-l border-zinc-800 shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 p-4">
          <div className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-emerald-400" />
            <h2 className="text-lg font-bold text-white">Play Cart</h2>
            <span className="text-sm text-zinc-400">({items.length})</span>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
              <ShoppingBag className="h-12 w-12 mb-3 opacity-30" />
              <p className="text-sm">Your Play Cart is empty</p>
              <p className="text-xs mt-1">Add courts and slots to get started</p>
            </div>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-zinc-800 bg-zinc-900 p-4"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <p className="font-medium text-white">
                      {item.sportName} — {item.courtSize}
                    </p>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      {item.courtLabel}
                    </p>
                    <p className="text-xs text-zinc-400 mt-1">
                      {new Date(item.date + "T00:00:00").toLocaleDateString(
                        "en-IN",
                        { weekday: "short", day: "numeric", month: "short" }
                      )}
                    </p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {item.slots.map((h) => formatHour(h)).join(", ")}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className="text-sm font-semibold text-emerald-400">
                      {formatPrice(item.totalAmount)}
                    </span>
                    <button
                      onClick={() => removeItem(item.id)}
                      className="rounded-lg p-1.5 text-zinc-500 hover:bg-red-500/10 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div className="border-t border-zinc-800 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-400">Total</span>
              <span className="text-lg font-bold text-white">
                {formatPrice(totalAmount)}
              </span>
            </div>
            <button
              onClick={handleCheckout}
              className="w-full rounded-xl bg-emerald-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-emerald-700 flex items-center justify-center gap-2"
            >
              Proceed to Checkout
              <ArrowRight className="h-4 w-4" />
            </button>
            <button
              onClick={() => {
                clearCart();
                setIsOpen(false);
              }}
              className="w-full text-center text-xs text-zinc-500 hover:text-red-400 transition-colors"
            >
              Clear Cart
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
