"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { updateCafeOrderStatus } from "@/actions/admin-cafe-orders";
import { CafeOrderStatus, PaymentMethod, PaymentStatus } from "@prisma/client";
import {
  Plus,
  Clock,
  ChefHat,
  Bell,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Search,
  IndianRupee,
  TrendingUp,
  Loader2,
  Calendar,
} from "lucide-react";
import { formatPrice } from "@/lib/pricing";

interface OrderRow {
  id: string;
  orderNumber: string;
  status: CafeOrderStatus;
  totalAmount: number;
  note: string | null;
  guestName: string | null;
  guestPhone: string | null;
  createdAt: string;
  user: { name: string | null; email: string | null; phone: string | null } | null;
  items: {
    id: string;
    itemName: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    isVeg: boolean;
  }[];
  payment: { method: PaymentMethod; status: PaymentStatus } | null;
  createdByAdmin: string | null;
}

interface Stats {
  todayOrders: number;
  todayRevenue: number;
  pendingCount: number;
  popularItems: { name: string; quantity: number }[];
}

const STATUS_CONFIG: Record<
  CafeOrderStatus,
  { icon: typeof Clock; color: string; bg: string; label: string }
> = {
  PENDING: { icon: Clock, color: "text-yellow-400", bg: "bg-yellow-500/10", label: "Pending" },
  PREPARING: { icon: ChefHat, color: "text-blue-400", bg: "bg-blue-500/10", label: "Preparing" },
  READY: { icon: Bell, color: "text-purple-400", bg: "bg-purple-500/10", label: "Ready" },
  COMPLETED: { icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10", label: "Completed" },
  CANCELLED: { icon: XCircle, color: "text-red-400", bg: "bg-red-500/10", label: "Cancelled" },
};

const NEXT_STATUS: Partial<Record<CafeOrderStatus, CafeOrderStatus>> = {
  PENDING: "PREPARING",
  PREPARING: "READY",
  READY: "COMPLETED",
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function CafeOrdersClient({
  orders,
  stats,
  total,
  totalPages,
  currentPage,
  currentStatus,
  currentDate,
}: {
  orders: OrderRow[];
  stats: Stats;
  total: number;
  totalPages: number;
  currentPage: number;
  currentStatus: string;
  currentDate: string;
}) {
  const router = useRouter();
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const handleStatusChange = async (
    orderId: string,
    newStatus: CafeOrderStatus
  ) => {
    setUpdatingId(orderId);
    const result = await updateCafeOrderStatus(orderId, newStatus);
    if (!result.success) {
      alert(result.error);
    }
    setUpdatingId(null);
    router.refresh();
  };

  function filterUrl(overrides: Record<string, string>) {
    const base: Record<string, string> = {
      status: currentStatus,
      date: currentDate,
      page: "1",
    };
    const merged = { ...base, ...overrides };
    const qs = Object.entries(merged)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");
    return `/admin/cafe-orders${qs ? `?${qs}` : ""}`;
  }

  const statuses: { value: string; label: string }[] = [
    { value: "", label: "All" },
    { value: "PENDING", label: "Pending" },
    { value: "PREPARING", label: "Preparing" },
    { value: "READY", label: "Ready" },
    { value: "COMPLETED", label: "Completed" },
    { value: "CANCELLED", label: "Cancelled" },
  ];

  return (
    <div className="space-y-4">
      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-xs text-zinc-500">Today&apos;s Orders</p>
          <p className="mt-1 text-2xl font-bold text-white">
            {stats.todayOrders}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-xs text-zinc-500">Today&apos;s Revenue</p>
          <p className="mt-1 text-2xl font-bold text-emerald-400">
            {formatPrice(stats.todayRevenue)}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-xs text-zinc-500">Pending Orders</p>
          <p className="mt-1 text-2xl font-bold text-yellow-400">
            {stats.pendingCount}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-xs text-zinc-500">Top Item Today</p>
          <p className="mt-1 text-sm font-medium text-white truncate">
            {stats.popularItems[0]?.name || "—"}
          </p>
          {stats.popularItems[0] && (
            <p className="text-xs text-zinc-500">
              {stats.popularItems[0].quantity} sold
            </p>
          )}
        </div>
      </div>

      {/* Filters row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {statuses.map((s) => (
            <Link
              key={s.value}
              href={filterUrl({ status: s.value })}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                currentStatus === s.value
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"
              }`}
            >
              {s.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-zinc-400" />
            <input
              type="date"
              value={currentDate}
              onChange={(e) =>
                router.push(filterUrl({ date: e.target.value }))
              }
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-white"
            />
          </div>
          <Link
            href="/admin/cafe-orders/create"
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Order
          </Link>
        </div>
      </div>

      {/* Orders list */}
      {orders.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-12 text-center">
          <Search className="mx-auto h-12 w-12 text-zinc-600" />
          <p className="mt-3 text-zinc-400">No orders found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {orders.map((order) => {
            const statusInfo = STATUS_CONFIG[order.status];
            const StatusIcon = statusInfo.icon;
            const nextStatus = NEXT_STATUS[order.status];
            const customerName =
              order.user?.name || order.guestName || "Walk-in";

            return (
              <div
                key={order.id}
                className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 transition-all hover:border-zinc-700"
              >
                <div className="flex items-center justify-between gap-3">
                  <Link
                    href={`/admin/cafe-orders/${order.id}`}
                    className="flex items-center gap-3 flex-1 min-w-0"
                  >
                    <div className={`rounded-lg ${statusInfo.bg} p-2`}>
                      <StatusIcon
                        className={`h-4 w-4 ${statusInfo.color}`}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-bold text-white">
                          {order.orderNumber}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusInfo.bg} ${statusInfo.color}`}
                        >
                          {statusInfo.label}
                        </span>
                        {order.createdByAdmin && (
                          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                            Staff
                          </span>
                        )}
                        {order.payment && (
                          <span className="text-[10px] text-zinc-500">
                            {order.payment.method.replace("_", " ")}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {customerName} &middot;{" "}
                        {order.items
                          .map((i) => `${i.quantity}x ${i.itemName}`)
                          .join(", ")}
                      </p>
                    </div>
                  </Link>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <p className="text-sm font-semibold text-white">
                        {formatPrice(order.totalAmount)}
                      </p>
                      <p className="text-[10px] text-zinc-500">
                        {timeAgo(order.createdAt)}
                      </p>
                    </div>
                    {/* Status transition buttons */}
                    {nextStatus && (
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          handleStatusChange(order.id, nextStatus);
                        }}
                        disabled={updatingId === order.id}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                          STATUS_CONFIG[nextStatus].bg
                        } ${STATUS_CONFIG[nextStatus].color} border border-current/20 hover:opacity-80 disabled:opacity-50`}
                      >
                        {updatingId === order.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          STATUS_CONFIG[nextStatus].label
                        )}
                      </button>
                    )}
                    <Link href={`/admin/cafe-orders/${order.id}`}>
                      <ChevronRight className="h-4 w-4 text-zinc-600 hover:text-zinc-400" />
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <Link
              key={p}
              href={filterUrl({ page: p.toString() })}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                p === currentPage
                  ? "bg-emerald-500/20 text-emerald-400"
                  : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
              }`}
            >
              {p}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
