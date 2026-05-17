import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, ImageOff } from "lucide-react";
import { auth } from "@/lib/auth";
import { listMyOrders } from "@/actions/shop-order";
import { formatPrice } from "@/lib/pricing";
import { ProductOrderStatus } from "@prisma/client";
import { BackButton } from "@/components/back-button";

export const dynamic = "force-dynamic";

const STATUS_PILL: Record<string, string> = {
  PENDING: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  CONFIRMED: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  FULFILLED: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  CANCELLED: "border-red-500/40 bg-red-500/10 text-red-300",
  REFUNDED: "border-blue-500/40 bg-blue-500/10 text-blue-300",
};

export default async function MyShopOrdersPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?redirect=/shop/orders");
  }
  const orders = await listMyOrders();

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      {/* Generic Back — returns the user to wherever they came from
          (Account, dashboard, or shop). Was hardcoded "Back to shop"
          → always dumped them on /shop even if they reached this
          page from /account. Matches the same fix shipped for the
          order detail page. */}
      <BackButton className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-white" />
      <h1 className="mt-3 text-2xl font-bold text-white">My orders</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Everything you've bought from the shop. Tap an order for items + payment.
      </p>

      {orders.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900 p-8 text-center">
          <p className="text-zinc-400">You haven't placed any shop orders yet.</p>
          <Link
            href="/shop"
            className="mt-3 inline-block rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            Browse products
          </Link>
        </div>
      ) : (
        <ul className="mt-5 space-y-3">
          {orders.map((order) => {
            const itemCount = order.items.reduce((s, i) => s + i.quantity, 0);
            const firstFew = order.items.slice(0, 3);
            return (
              <li key={order.id}>
                <Link
                  href={`/shop/orders/${order.id}`}
                  className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 transition-colors hover:border-zinc-700"
                >
                  {/* Stacked thumbnails — first 3 items */}
                  <div className="flex -space-x-2">
                    {firstFew.map((line, i) => (
                      <div
                        key={line.id}
                        className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-md border border-zinc-800 bg-zinc-800 text-zinc-500"
                        style={{ zIndex: 10 - i }}
                        title={line.nameSnapshot}
                      >
                        <ImageOff className="h-3 w-3" />
                      </div>
                    ))}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-mono text-sm font-semibold text-emerald-300">
                        {order.orderNumber ??
                          `#${order.id.slice(-6).toUpperCase()}`}
                      </p>
                      <StatusPill status={order.status} />
                    </div>
                    <p className="mt-0.5 truncate text-xs text-zinc-500">
                      {itemCount} item{itemCount === 1 ? "" : "s"} ·{" "}
                      {new Date(order.createdAt).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        timeZone: "Asia/Kolkata",
                      })}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="font-mono text-sm font-bold text-emerald-300">
                      {formatPrice(Math.round(order.totalPaise / 100))}
                    </p>
                  </div>

                  <ChevronRight className="h-4 w-4 flex-shrink-0 text-zinc-600" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

function StatusPill({ status }: { status: ProductOrderStatus }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
        STATUS_PILL[status] ?? "border-zinc-700 text-zinc-300"
      }`}
    >
      {status}
    </span>
  );
}

