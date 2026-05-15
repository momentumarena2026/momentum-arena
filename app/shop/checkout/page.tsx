import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { getCartForUser } from "@/lib/cart";
import { getCheckoutPaymentConfig } from "@/actions/admin-payment-settings";
import { CheckoutClient } from "./checkout-client";

export const dynamic = "force-dynamic";

export default async function ShopCheckoutPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?redirect=/shop/checkout");
  }

  const [cart, paymentConfig] = await Promise.all([
    getCartForUser(session.user.id),
    getCheckoutPaymentConfig(),
  ]);

  if (cart.lines.length === 0) {
    redirect("/shop/cart");
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <Link
        href="/shop/cart"
        className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-white"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to cart
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-white">Checkout</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Pay now and pick up at the venue. We'll text you when it's ready.
      </p>

      <CheckoutClient
        cart={cart}
        gateway={paymentConfig.activeGateway}
        onlineEnabled={paymentConfig.onlineEnabled}
        upiQrEnabled={paymentConfig.upiQrEnabled}
        user={{
          name: session.user.name ?? null,
          email: session.user.email ?? null,
          phone:
            (session.user as { phone?: string | null }).phone ?? null,
        }}
      />
    </main>
  );
}
