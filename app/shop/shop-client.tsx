"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ImageOff, Loader2, Minus, Plus, ShoppingCart } from "lucide-react";
import { formatPrice } from "@/lib/pricing";
import {
  addProductToCart,
  mergeLocalCart,
  setCartItemQuantity,
} from "@/actions/shop";
import type { CartSnapshot } from "@/lib/cart";
import type { PublicProduct } from "@/lib/product";
import {
  loadLocalCart,
  saveLocalCart,
  removeLocalCart,
} from "./local-cart";

interface Props {
  products: PublicProduct[];
  initialCart: CartSnapshot;
  isSignedIn: boolean;
}

/**
 * Customer-facing shop page. Renders the catalog as a card grid
 * with category headers and per-card quantity stepper. Signed-in
 * users hit the server cart directly; anonymous users mutate a
 * localStorage shadow cart that merges into the server on sign-in.
 */
export function ShopClient({ products, initialCart, isSignedIn }: Props) {
  const router = useRouter();
  const [cart, setCart] = useState<CartSnapshot>(initialCart);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Sign-in merge: when the user lands here with a localStorage cart
  // and a fresh session, push that into the server cart and drop
  // the local copy so it doesn't double-add later.
  useEffect(() => {
    if (!isSignedIn) return;
    const local = loadLocalCart();
    if (local.length === 0) return;
    startTransition(async () => {
      const res = await mergeLocalCart(local);
      if (res.success && res.cart) {
        setCart(res.cart);
      }
      removeLocalCart();
    });
  }, [isSignedIn]);

  // Map productId → cart line quantity for cheap render-time lookups.
  const quantityByProduct = new Map(cart.lines.map((l) => [l.productId, l.quantity]));

  function localQuantity(productId: string): number {
    return quantityByProduct.get(productId) ?? 0;
  }

  function updateLocalCart(productId: string, qty: number) {
    const lines = loadLocalCart();
    const next = lines.filter((l) => l.productId !== productId);
    if (qty > 0) next.push({ productId, quantity: qty });
    saveLocalCart(next);
  }

  async function add(product: PublicProduct, qty: number) {
    if (!product.isInStock) return;
    setError(null);
    setPendingId(product.id);
    try {
      if (isSignedIn) {
        const res = await addProductToCart(product.id, qty);
        if (!res.success || !res.cart) {
          setError(res.error ?? "Couldn't add to cart");
          return;
        }
        setCart(res.cart);
      } else {
        // Anonymous: maintain a local shadow cart. We don't have
        // server-side stock semantics here so we just trust the
        // quantity within the displayed stockQuantity bound.
        const current = localQuantity(product.id);
        const desired = Math.min(product.stockQuantity, current + qty);
        updateLocalCart(product.id, desired);
        setCart(snapshotFromLocal(products));
      }
    } finally {
      setPendingId(null);
    }
  }

  async function setQty(product: PublicProduct, qty: number) {
    setError(null);
    setPendingId(product.id);
    try {
      if (isSignedIn) {
        const res = await setCartItemQuantity(product.id, qty);
        if (!res.success || !res.cart) {
          setError(res.error ?? "Couldn't update cart");
          return;
        }
        setCart(res.cart);
      } else {
        updateLocalCart(product.id, qty);
        setCart(snapshotFromLocal(products));
      }
    } finally {
      setPendingId(null);
    }
  }

  // Group by category for headers.
  const grouped: Array<{
    categoryId: string | null;
    categoryName: string | null;
    items: PublicProduct[];
  }> = [];
  for (const p of products) {
    const existing = grouped.find((g) => g.categoryId === p.categoryId);
    if (existing) existing.items.push(p);
    else grouped.push({ categoryId: p.categoryId, categoryName: p.categoryName, items: [p] });
  }

  return (
    <div className="space-y-8">
      {/* Sticky cart pill — links to /shop/cart with a count badge */}
      <div className="sticky top-2 z-30 flex justify-end">
        <Link
          href="/shop/cart"
          onClick={() => router.refresh()}
          className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-200 shadow-lg backdrop-blur hover:border-emerald-400 hover:bg-emerald-500/15"
        >
          <ShoppingCart className="h-4 w-4" />
          Cart · {cart.itemCount}
          {cart.totalPaise > 0 ? (
            <span className="text-emerald-300">· {formatPrice(Math.round(cart.totalPaise / 100))}</span>
          ) : null}
        </Link>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      {products.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center text-zinc-400">
          Nothing in stock right now. Check back soon!
        </div>
      ) : null}

      {grouped.map((g) => (
        <section key={g.categoryId ?? "uncat"} className="space-y-3">
          {g.categoryName ? (
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
              {g.categoryName}
            </h2>
          ) : null}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {g.items.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                quantity={localQuantity(p.id)}
                pending={pendingId === p.id}
                onAdd={() => add(p, 1)}
                onIncrement={() => setQty(p, localQuantity(p.id) + 1)}
                onDecrement={() => setQty(p, Math.max(0, localQuantity(p.id) - 1))}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ProductCard({
  product,
  quantity,
  pending,
  onAdd,
  onIncrement,
  onDecrement,
}: {
  product: PublicProduct;
  quantity: number;
  pending: boolean;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
}) {
  const inCart = quantity > 0;
  const outOfStock = !product.isInStock;
  const reachedMax = quantity >= product.stockQuantity;

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-xl border ${
        outOfStock
          ? "border-zinc-800 bg-zinc-900/40 opacity-60"
          : "border-zinc-800 bg-zinc-900"
      }`}
    >
      <div className="relative aspect-square w-full bg-zinc-800">
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt={product.name}
            fill
            sizes="(max-width: 640px) 50vw, 25vw"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-zinc-700">
            <ImageOff className="h-6 w-6" />
          </div>
        )}
        {outOfStock ? (
          <div className="absolute inset-x-0 bottom-0 bg-black/70 py-1 text-center text-[10px] font-semibold uppercase tracking-wider text-red-300">
            Out of stock
          </div>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col p-3">
        <h3 className="text-sm font-semibold text-white">{product.name}</h3>
        {product.description ? (
          <p className="mt-1 line-clamp-2 text-xs text-zinc-400">
            {product.description}
          </p>
        ) : null}
        <div className="mt-2 flex items-center justify-between">
          <span className="text-sm font-bold text-emerald-300">
            {formatPrice(Math.round(product.pricePaise / 100))}
          </span>
          {!outOfStock ? (
            inCart ? (
              <div className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-950">
                <button
                  type="button"
                  onClick={onDecrement}
                  disabled={pending}
                  className="p-1.5 text-zinc-300 hover:text-white disabled:opacity-50"
                >
                  <Minus className="h-3 w-3" />
                </button>
                <span className="min-w-[1.5rem] text-center text-sm font-semibold text-white">
                  {pending ? <Loader2 className="mx-auto h-3 w-3 animate-spin" /> : quantity}
                </span>
                <button
                  type="button"
                  onClick={onIncrement}
                  disabled={pending || reachedMax}
                  className="p-1.5 text-zinc-300 hover:text-white disabled:opacity-50"
                  title={reachedMax ? "Reached stock limit" : "Add another"}
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onAdd}
                disabled={pending}
                className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
              >
                {pending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Plus className="h-3 w-3" />
                )}
                Add
              </button>
            )
          ) : null}
        </div>
        {product.stockQuantity > 0 && product.stockQuantity <= 5 ? (
          <p className="mt-1 text-[10px] text-amber-400">
            Only {product.stockQuantity} left
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ── Local-cart snapshot helper (for anonymous browsing) ────────────────────
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
