import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getMyCafeOrders } from "@/actions/cafe-orders";
import { formatPrice } from "@/lib/pricing";
import {
  Clock,
  ChefHat,
  Bell,
  CheckCircle2,
  XCircle,
  Hourglass,
  Coffee,
  ArrowLeft,
} from "lucide-react";

// Order history changes the moment an order is placed; render on
// every request rather than hold a stale ISR snapshot.
export const dynamic = "force-dynamic";

/**
 * Status pill config, keyed by CafeOrderStatus value. PENDING_PAYMENT
 * is mid-checkout (gateway hasn't confirmed yet) — we still surface
 * it here so a customer who bounced from Razorpay can see the
 * intent and either retry payment or wait for it to be cancelled
 * automatically. Friendly labels mirror what we'd say to the
 * customer face-to-face; the raw enum names ("PREPARING") are too
 * blunt.
 */
const STATUS_META: Record<
  string,
  { label: string; icon: typeof Clock; pill: string; note?: string }
> = {
  PENDING_PAYMENT: {
    label: "Payment in progress",
    icon: Hourglass,
    pill: "border-zinc-700 bg-zinc-800/60 text-zinc-300",
    note: "Waiting for the payment gateway to confirm.",
  },
  PENDING: {
    label: "Order received",
    icon: Clock,
    pill: "border-yellow-500/30 bg-yellow-500/10 text-yellow-300",
    note: "We've got your order — kitchen will pick it up shortly.",
  },
  PREPARING: {
    label: "In the kitchen",
    icon: ChefHat,
    pill: "border-blue-500/30 bg-blue-500/10 text-blue-300",
    note: "Your order is being prepared.",
  },
  READY: {
    label: "Ready for pickup",
    icon: Bell,
    pill: "border-purple-500/30 bg-purple-500/10 text-purple-300",
    note: "Head to the counter — your order is ready.",
  },
  COMPLETED: {
    label: "Completed",
    icon: CheckCircle2,
    pill: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  },
  CANCELLED: {
    label: "Cancelled",
    icon: XCircle,
    pill: "border-red-500/30 bg-red-500/10 text-red-300",
  },
};

function StatusPill({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.PENDING;
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${meta.pill}`}
    >
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

export default async function CafeOrdersPage() {
  const session = await auth();
  if (!session?.user?.id) {
    // Not signed in — bounce to the menu (which is browsable
    // anonymously). The cafe orders page is meaningless without a
    // signed-in identity.
    redirect("/cafe");
  }

  const orders = await getMyCafeOrders();

  return (
    <div className="min-h-screen bg-black">
      {/* Plain page heading — the shared SiteHeader is the only header
          chrome; the amber cafe-branded bar is gone. */}
      <div className="max-w-3xl mx-auto px-4 pt-6 sm:pt-8">
        <Link
          href="/cafe"
          className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-white transition-colors mb-3"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to menu
        </Link>
        <h1 className="text-2xl sm:text-3xl font-bold text-white">
          My Cafe Orders
        </h1>
        <p className="text-zinc-400 text-sm mt-1">
          Everything you&apos;ve ordered from the cafe.
        </p>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 sm:py-8">
        {orders.length === 0 ? (
          <div className="text-center py-20">
            <Coffee className="mx-auto h-12 w-12 text-amber-300/40" />
            <p className="text-zinc-300 text-lg mt-4 mb-1">No orders yet</p>
            <p className="text-zinc-500 text-sm mb-6 max-w-xs mx-auto">
              When you place an order from the cafe menu, it'll show up here.
            </p>
            <Link
              href="/cafe"
              className="inline-flex items-center gap-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold px-5 py-2.5 transition-colors"
            >
              <Coffee className="h-4 w-4" />
              Browse Menu
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => {
              const meta =
                STATUS_META[order.status] ?? STATUS_META.PENDING;
              const placedAt = new Date(order.createdAt).toLocaleString(
                "en-IN",
                {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                },
              );

              // For PENDING_PAYMENT we send to the menu — the
              // confirmation page won't have a useful state until
              // the gateway resolves. Everything else goes to the
              // existing /cafe/confirmation/[id] view.
              const targetHref =
                order.status === "PENDING_PAYMENT"
                  ? "/cafe"
                  : `/cafe/confirmation/${order.id}`;

              return (
                <Link
                  key={order.id}
                  href={targetHref}
                  className="block rounded-xl border border-zinc-800 bg-zinc-900 p-4 hover:border-amber-700/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="font-bold text-white text-sm">
                          {order.orderNumber}
                        </span>
                        <StatusPill status={order.status} />
                      </div>
                      <p className="text-zinc-500 text-[11px]">{placedAt}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-white font-bold text-sm">
                        {formatPrice(order.totalAmount)}
                      </p>
                      <p className="text-zinc-500 text-[11px]">
                        {order.items.length}{" "}
                        item{order.items.length !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>

                  {/* Item rows — name + qty, with a veg/non-veg
                      dot. Truncated to two lines on small screens
                      via line-clamp. */}
                  <div className="space-y-1 mt-2">
                    {order.items.slice(0, 3).map((line) => (
                      <div
                        key={line.id}
                        className="flex items-center gap-2 text-xs text-zinc-300"
                      >
                        <span
                          className={`inline-block h-2 w-2 rounded-sm border ${
                            line.cafeItem?.isVeg
                              ? "border-green-500 bg-green-500"
                              : "border-red-500 bg-red-500"
                          }`}
                        />
                        <span className="truncate flex-1">
                          {line.itemName}
                        </span>
                        <span className="text-zinc-500 flex-shrink-0">
                          × {line.quantity}
                        </span>
                      </div>
                    ))}
                    {order.items.length > 3 ? (
                      <p className="text-[11px] text-zinc-500 pl-4">
                        +{order.items.length - 3} more item
                        {order.items.length - 3 !== 1 ? "s" : ""}
                      </p>
                    ) : null}
                  </div>

                  {meta.note ? (
                    <p className="text-[11px] text-zinc-500 mt-3 italic">
                      {meta.note}
                    </p>
                  ) : null}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
