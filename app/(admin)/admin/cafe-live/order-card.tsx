"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { updateCafeOrderStatus } from "@/actions/admin-cafe-orders";
import { CafeOrderStatus } from "@prisma/client";
import { Loader2, X } from "lucide-react";
import { formatPrice } from "@/lib/pricing";

export interface LiveOrder {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: number;
  tableNumber: number | null;
  note: string | null;
  guestName: string | null;
  createdAt: string;
  customerName: string;
  items: {
    id: string;
    itemName: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    isVeg: boolean;
  }[];
  payment: { method: string; status: string } | null;
}

const statusConfig: Record<
  string,
  {
    nextStatus: CafeOrderStatus;
    actionLabel: string;
    actionColor: string;
    borderColor: string;
    orderNumberColor: string;
  }
> = {
  PENDING: {
    nextStatus: "PREPARING",
    actionLabel: "Start Preparing",
    actionColor: "bg-amber-500 hover:bg-amber-600 text-white",
    borderColor: "border-amber-500/30",
    orderNumberColor: "text-amber-400",
  },
  PREPARING: {
    nextStatus: "READY",
    actionLabel: "Mark Ready",
    actionColor: "bg-blue-500 hover:bg-blue-600 text-white",
    borderColor: "border-blue-500/30",
    orderNumberColor: "text-blue-400",
  },
  READY: {
    nextStatus: "COMPLETED",
    actionLabel: "Complete",
    actionColor: "bg-emerald-500 hover:bg-emerald-600 text-white",
    borderColor: "border-emerald-500/30",
    orderNumberColor: "text-emerald-400",
  },
};

function timeAgo(dateStr: string) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  return `${diffHrs}h ${diffMins % 60}m ago`;
}

export function OrderCard({ order }: { order: LiveOrder }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [elapsed, setElapsed] = useState(timeAgo(order.createdAt));

  const config = statusConfig[order.status];

  // Auto-update elapsed time every 30s
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(timeAgo(order.createdAt));
    }, 30000);
    setElapsed(timeAgo(order.createdAt));
    return () => clearInterval(interval);
  }, [order.createdAt]);

  async function handleAdvance() {
    if (!config) return;
    setLoading(true);
    try {
      const result = await updateCafeOrderStatus(order.id, config.nextStatus);
      if (!result.success) {
        console.error(result.error);
      }
      router.refresh();
    } catch (err) {
      console.error("Failed to update status:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel() {
    if (!confirm("Cancel this order?")) return;
    setCancelling(true);
    try {
      const result = await updateCafeOrderStatus(order.id, "CANCELLED");
      if (!result.success) {
        console.error(result.error);
      }
      router.refresh();
    } catch (err) {
      console.error("Failed to cancel order:", err);
    } finally {
      setCancelling(false);
    }
  }

  // Compact items string
  const itemsStr = order.items
    .map((i) => `${i.quantity}\u00d7 ${i.itemName}`)
    .join(", ");

  return (
    <div
      className={`rounded-xl border bg-zinc-900 shadow-lg ${config?.borderColor ?? "border-zinc-700"}`}
    >
      <div className="p-4 space-y-3">
        {/* Header row: order number + elapsed */}
        <div className="flex items-center justify-between">
          <span
            className={`text-sm font-bold ${config?.orderNumberColor ?? "text-zinc-300"}`}
          >
            {order.orderNumber}
          </span>
          <span className="text-xs text-zinc-500">{elapsed}</span>
        </div>

        {/* Table + Customer */}
        <div className="flex items-center gap-2 flex-wrap">
          {order.tableNumber ? (
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-400 border border-amber-500/30">
              Table {order.tableNumber}
            </span>
          ) : (
            <span className="rounded-full bg-zinc-700/50 px-2 py-0.5 text-xs font-medium text-zinc-400 border border-zinc-600">
              Takeaway
            </span>
          )}
          <span className="text-sm text-zinc-300 truncate">
            {order.customerName}
          </span>
        </div>

        {/* Items */}
        <div className="text-sm text-zinc-400">
          {order.items.map((item, idx) => (
            <span key={item.id}>
              {idx > 0 && ", "}
              <span
                className={`inline-block h-2 w-2 rounded-full mr-0.5 ${item.isVeg ? "bg-green-500" : "bg-red-500"}`}
              />
              {item.quantity}&times; {item.itemName}
            </span>
          ))}
        </div>

        {/* Total */}
        <div className="text-sm font-semibold text-white">
          {formatPrice(order.totalAmount)}
        </div>

        {/* Note */}
        {order.note && (
          <p className="text-xs italic text-zinc-500 border-l-2 border-zinc-700 pl-2">
            {order.note}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          {config && (
            <button
              onClick={handleAdvance}
              disabled={loading}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${config.actionColor}`}
            >
              {loading ? (
                <Loader2 className="mx-auto h-4 w-4 animate-spin" />
              ) : (
                config.actionLabel
              )}
            </button>
          )}
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="rounded-lg px-2 py-2 text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors disabled:opacity-50"
            title="Cancel order"
          >
            {cancelling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <X className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
