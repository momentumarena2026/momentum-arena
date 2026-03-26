import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getMyCafeOrders } from "@/actions/cafe-orders";
import { formatPrice } from "@/lib/pricing";

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  PREPARING: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  READY: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  COMPLETED: "bg-green-500/20 text-green-400 border-green-500/30",
  CANCELLED: "bg-red-500/20 text-red-400 border-red-500/30",
};

export default async function CafeOrdersPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/cafe");

  const orders = await getMyCafeOrders();

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">My Cafe Orders</h1>
        <Link
          href="/cafe"
          className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
        >
          Browse Menu
        </Link>
      </div>

      {orders.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-5xl mb-4">☕</div>
          <p className="text-zinc-400 text-lg mb-2">No orders yet</p>
          <p className="text-zinc-600 text-sm mb-6">
            Order something delicious from our cafe!
          </p>
          <Link
            href="/cafe"
            className="inline-block bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-6 py-2.5 rounded-lg transition-colors"
          >
            Browse Menu
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => {
            const itemsSummary = order.items
              .slice(0, 3)
              .map((i) => `${i.itemName} x${i.quantity}`)
              .join(", ");
            const moreCount = order.items.length - 3;

            return (
              <div
                key={order.id}
                className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-white font-bold text-sm">
                        {order.orderNumber}
                      </span>
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                          STATUS_COLORS[order.status] || STATUS_COLORS.PENDING
                        }`}
                      >
                        {order.status}
                      </span>
                    </div>
                    <p className="text-zinc-400 text-xs mb-2">
                      {new Date(order.createdAt).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                    <p className="text-zinc-500 text-xs truncate">
                      {itemsSummary}
                      {moreCount > 0 && ` +${moreCount} more`}
                    </p>
                  </div>

                  <div className="text-right flex-shrink-0">
                    <p className="text-white font-bold text-sm">
                      {formatPrice(order.totalAmount)}
                    </p>
                    <div className="flex gap-2 mt-2">
                      <a
                        href={`/api/cafe-invoice?orderId=${order.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-zinc-400 hover:text-emerald-400 transition-colors"
                      >
                        Invoice
                      </a>
                      <Link
                        href={`/cafe/confirmation/${order.id}`}
                        className="text-xs text-zinc-400 hover:text-emerald-400 transition-colors"
                      >
                        Details
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
