import { auth } from "@/lib/auth";
import { listShopProducts } from "@/lib/product";
import { getCartForUser } from "@/lib/cart";
import { ShopClient } from "./shop-client";

export const dynamic = "force-dynamic";

export default async function ShopPage() {
  const [session, products] = await Promise.all([
    auth(),
    listShopProducts(),
  ]);

  const cart = session?.user?.id
    ? await getCartForUser(session.user.id)
    : { lines: [], totalPaise: 0, itemCount: 0 };

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white sm:text-3xl">Shop</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Buy gear and gear up — pick up at the venue.
        </p>
      </div>

      <ShopClient
        products={products}
        initialCart={cart}
        isSignedIn={!!session?.user?.id}
      />
    </main>
  );
}
