import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { notFound } from "next/navigation";
import { formatPrice } from "@/lib/pricing";
import { CafeOrderActions } from "./cafe-order-actions";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export default async function CafeOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin("MANAGE_CAFE_ORDERS");
  const { id } = await params;

  const order = await db.cafeOrder.findUnique({
    where: { id },
    include: {
      items: {
        include: { cafeItem: { select: { name: true, isVeg: true, isAvailable: true } } },
      },
      user: { select: { id: true, name: true, email: true, phone: true } },
      payment: true,
      createdByAdmin: { select: { username: true } },
      editHistory: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!order) notFound();

  // Fetch available menu items for add-item feature
  const availableItems = await db.cafeItem.findMany({
    where: { isAvailable: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: { id: true, name: true, category: true, price: true, isVeg: true },
  });

  const statusColors: Record<string, string> = {
    PENDING: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
    PREPARING: "text-blue-400 bg-blue-500/10 border-blue-500/30",
    READY: "text-purple-400 bg-purple-500/10 border-purple-500/30",
    COMPLETED: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
    CANCELLED: "text-red-400 bg-red-500/10 border-red-500/30",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/cafe-orders"
          className="rounded-lg border border-zinc-700 bg-zinc-800 p-2 hover:bg-zinc-700"
        >
          <ChevronLeft className="h-4 w-4 text-zinc-400" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-white">
            Order {order.orderNumber}
          </h1>
          <p className="mt-0.5 text-sm text-zinc-400">
            Created{" "}
            {order.createdAt.toLocaleString("en-IN", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
            {order.createdByAdmin &&
              ` by ${order.createdByAdmin.username}`}
          </p>
        </div>
        <span
          className={`ml-auto rounded-full border px-3 py-1 text-sm font-medium ${
            statusColors[order.status]
          }`}
        >
          {order.status}
        </span>
      </div>

      {/* Order info cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Customer */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <h3 className="text-xs font-medium text-zinc-500 uppercase">
            Customer
          </h3>
          {order.user ? (
            <div className="mt-2">
              <p className="text-sm font-medium text-white">
                {order.user.name || "Unnamed"}
              </p>
              <p className="text-xs text-zinc-400">
                {order.user.email} {order.user.phone && `| ${order.user.phone}`}
              </p>
            </div>
          ) : (
            <div className="mt-2">
              <p className="text-sm font-medium text-white">
                {order.guestName || "Walk-in"}
              </p>
              {order.guestPhone && (
                <p className="text-xs text-zinc-400">{order.guestPhone}</p>
              )}
            </div>
          )}
        </div>

        {/* Payment */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <h3 className="text-xs font-medium text-zinc-500 uppercase">
            Payment
          </h3>
          {order.payment ? (
            <div className="mt-2">
              <p className="text-lg font-bold text-emerald-400">
                {formatPrice(order.payment.amount)}
              </p>
              <p className="text-xs text-zinc-400">
                {order.payment.method.replace("_", " ")} &middot;{" "}
                {order.payment.status}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-zinc-500">No payment info</p>
          )}
        </div>
      </div>

      {/* Items table */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="text-xs font-medium text-zinc-500 uppercase mb-3">
          Order Items
        </h3>
        <div className="space-y-2">
          {order.items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between py-2 border-b border-zinc-800 last:border-0"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block h-2 w-2 rounded-sm ${
                    item.cafeItem?.isVeg ? "bg-green-500" : "bg-red-500"
                  }`}
                />
                <span className="text-sm text-white">{item.itemName}</span>
                <span className="text-xs text-zinc-500">
                  x{item.quantity}
                </span>
              </div>
              <div className="text-right">
                <span className="text-sm text-white">
                  {formatPrice(item.totalPrice)}
                </span>
                <span className="text-xs text-zinc-500 ml-2">
                  @ {formatPrice(item.unitPrice)}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between pt-3 border-t border-zinc-700 mt-2">
          <span className="font-medium text-white">Total</span>
          <span className="text-lg font-bold text-emerald-400">
            {formatPrice(order.totalAmount)}
          </span>
        </div>
        {order.note && (
          <p className="mt-2 text-xs text-zinc-400 italic">
            Note: {order.note}
          </p>
        )}
      </div>

      {/* Actions component */}
      <CafeOrderActions
        order={{
          id: order.id,
          status: order.status,
          totalAmount: order.totalAmount,
          items: order.items.map((i) => ({
            id: i.id,
            cafeItemId: i.cafeItemId,
            itemName: i.itemName,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            totalPrice: i.totalPrice,
            isVeg: i.cafeItem?.isVeg ?? true,
          })),
        }}
        availableItems={availableItems}
        editHistory={order.editHistory.map((h) => ({
          id: h.id,
          editType: h.editType,
          adminUsername: h.adminUsername,
          note: h.note,
          previousAmount: h.previousAmount,
          newAmount: h.newAmount,
          createdAt: h.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
