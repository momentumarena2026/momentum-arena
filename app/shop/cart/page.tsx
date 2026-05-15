import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { getCartForUser } from "@/lib/cart";
import { listShopProducts } from "@/lib/product";
import { CartClient } from "./cart-client";

export const dynamic = "force-dynamic";

export default async function CartPage() {
  const session = await auth();
  const signedIn = !!session?.user?.id;
  const cart = signedIn
    ? await getCartForUser(session!.user!.id!)
    : { lines: [], totalPaise: 0, itemCount: 0 };

  // For anonymous users we still need a live product list to hydrate
  // the local-cart snapshot client-side (price + name + stock).
  const products = signedIn ? [] : await listShopProducts();

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <Link
        href="/shop"
        className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-white"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to shop
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-white">Your cart</h1>

      <CartClient
        initialCart={cart}
        productsForLocal={products}
        isSignedIn={signedIn}
      />
    </main>
  );
}
