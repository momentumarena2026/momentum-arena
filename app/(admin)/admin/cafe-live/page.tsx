import { getLiveCafeOrders } from "@/actions/admin-cafe-orders";
import { LiveOrders } from "./live-orders";

export default async function CafeLivePage() {
  const grouped = await getLiveCafeOrders();

  const serialized = {
    PENDING: grouped.PENDING.map(serializeOrder),
    PREPARING: grouped.PREPARING.map(serializeOrder),
    READY: grouped.READY.map(serializeOrder),
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Live Cafe Orders</h1>
        <p className="mt-1 text-zinc-400">
          Real-time kitchen order board
        </p>
      </div>
      <LiveOrders orders={serialized} />
    </div>
  );
}

function serializeOrder(o: any) {
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status as string,
    totalAmount: o.totalAmount,
    tableNumber: o.tableNumber,
    note: o.note,
    guestName: o.guestName,
    createdAt: o.createdAt.toISOString(),
    customerName: o.user?.name || o.guestName || "Walk-in",
    items: o.items.map((i: any) => ({
      id: i.id,
      itemName: i.itemName,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      totalPrice: i.totalPrice,
      isVeg: i.cafeItem?.isVeg ?? true,
    })),
    payment: o.payment
      ? { method: o.payment.method, status: o.payment.status }
      : null,
  };
}
