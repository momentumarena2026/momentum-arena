"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { ImageOff, Loader2, Minus, Plus, Trash2 } from "lucide-react";
import { formatPrice } from "@/lib/pricing";
import { emptyCart, setCartItemQuantity } from "@/actions/shop";
import {
  loadLocalCart,
  removeLocalCart,
  saveLocalCart,
} from "../local-cart";
import type { CartSnapshot } from "@/lib/cart";
import type { PublicProduct } from "@/lib/product";

interface Props {
  initialCart: CartSnapshot;
  productsForLocal: PublicProduct[];
  isSignedIn: boolean;
}

export function CartClient({ initialCart, productsForLocal, isSignedIn }: Props) {
  const [cart, setCart] = useState<CartSnapshot>(initialCart);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Hydrate the anonymous cart from localStorage on first paint.
  useEffect(() => {
    if (isSignedIn) return;
    setCart(snapshotFromLocal(productsForLocal));
  }, [isSignedIn, productsForLocal]);

  async function changeQty(productId: string, quantity: number) {
    setError(null);
    setPendingId(productId);
    try {
      if (isSignedIn) {
        const res = await setCartItemQuantity(productId, quantity);
        if (!res.success || !res.cart) {
          setError(res.error ?? "Couldn't update cart");
          return;
        }
        setCart(res.cart);
      } else {
        const local = loadLocalCart().filter((l) => l.productId !== productId);
        if (quantity > 0) local.push({ productId, quantity });
        saveLocalCart(local);
        setCart(snapshotFromLocal(productsForLocal));
      }
    } finally {
      setPendingId(null);
    }
  }

  async function clear() {
    startTransition(async () => {
      if (isSignedIn) {
        const res = await emptyCart();
        if (res.success && res.cart) setCart(res.cart);
      } else {
        removeLocalCart();
        setCart({ lines: [], totalPaise: 0, itemCount: 0 });
      }
    });
  }

  if (cart.lines.length === 0) {
    return (
      <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center">
        <p className="text-zinc-400">Your cart is empty.</p>
        <Link
          href="/shop"
          className="mt-3 inline-block rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500"
        >
          Browse products
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-3">
      {cart.lines.map((line) => {
        const isPending = pendingId === line.productId;
        const reachedMax = line.quantity >= line.stockQuantity;
        return (
          <div
            key={line.productId}
            className={`flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-3 ${
              line.unavailable ? "opacity-60" : ""
            }`}
          >
            <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-md bg-zinc-800">
              {line.imageUrl ? (
                <Image
                  src={line.imageUrl}
                  alt={line.name}
                  fill
                  sizes="64px"
                  className="object-cover"
                  unoptimized
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-zinc-600">
                  <ImageOff className="h-5 w-5" />
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-white">{line.name}</p>
              {line.unavailable ? (
                <p className="text-xs text-red-400">
                  Currently unavailable
                </p>
              ) : (
                <p className="text-xs text-zinc-400">
                  {formatPrice(Math.round(line.pricePaise / 100))} ×{" "}
                  {line.quantity}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2">
              {!line.unavailable ? (
                <div className="inline-flex items-center rounded-md border border-zinc-700 bg-zinc-950">
                  <button
                    type="button"
                    onClick={() => changeQty(line.productId, Math.max(0, line.quantity - 1))}
                    disabled={isPending}
                    className="p-2 text-zinc-300 hover:text-white disabled:opacity-50"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <span className="min-w-[1.5rem] text-center text-sm font-semibold text-white">
                    {isPending ? (
                      <Loader2 className="mx-auto h-3 w-3 animate-spin" />
                    ) : (
                      line.quantity
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => changeQty(line.productId, line.quantity + 1)}
                    disabled={isPending || reachedMax}
                    className="p-2 text-zinc-300 hover:text-white disabled:opacity-50"
                    title={reachedMax ? "Reached stock limit" : "Add another"}
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => changeQty(line.productId, 0)}
                disabled={isPending}
                className="rounded-md p-2 text-zinc-400 hover:bg-red-500/10 hover:text-red-400"
                title="Remove"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="hidden w-20 text-right text-sm font-semibold text-emerald-300 sm:block">
              {!line.unavailable
                ? formatPrice(Math.round((line.pricePaise * line.quantity) / 100))
                : "—"}
            </div>
          </div>
        );
      })}

      <div className="mt-4 flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-zinc-400">Total</p>
          <p className="text-2xl font-bold text-emerald-300">
            {formatPrice(Math.round(cart.totalPaise / 100))}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={clear}
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500"
          >
            Clear cart
          </button>
          {isSignedIn ? (
            <Link
              href="/shop/checkout"
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
            >
              Checkout
            </Link>
          ) : (
            <Link
              href="/login?redirect=/shop/cart"
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
            >
              Sign in to checkout
            </Link>
          )}
        </div>
      </div>

      {error ? (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function snapshotFromLocal(products: PublicProduct[]): CartSnapshot {
  const local = loadLocalCart();
  const lines = local
    .map((l) => {
      const p = products.find((x) => x.id === l.productId);
      if (!p) return null;
      const quantity = Math.min(l.quantity, p.stockQuantity);
      return {
        productId: p.id,
        name: p.name,
        pricePaise: p.pricePaise,
        quantity,
        stockQuantity: p.stockQuantity,
        imageUrl: p.imageUrl,
        unavailable: !p.isInStock,
      };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);
  const totalPaise = lines
    .filter((l) => !l.unavailable)
    .reduce((s, l) => s + l.pricePaise * l.quantity, 0);
  const itemCount = lines
    .filter((l) => !l.unavailable)
    .reduce((s, l) => s + l.quantity, 0);
  return { lines, totalPaise, itemCount };
}
