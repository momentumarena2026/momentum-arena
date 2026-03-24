"use client";

import { useCart } from "@/lib/cart-context";
import { ShoppingBag } from "lucide-react";

export function CartBadge() {
  const { itemCount, setIsOpen } = useCart();

  if (itemCount === 0) return null;

  return (
    <button
      onClick={() => setIsOpen(true)}
      className="fixed bottom-20 right-6 z-40 flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-3 text-white shadow-lg shadow-emerald-600/30 transition-all hover:bg-emerald-700 hover:scale-105"
    >
      <ShoppingBag className="h-5 w-5" />
      <span className="text-sm font-semibold">Play Cart</span>
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs font-bold text-emerald-700">
        {itemCount}
      </span>
    </button>
  );
}
