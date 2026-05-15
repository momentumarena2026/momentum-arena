import Link from "next/link";
import { listOrdersForAdmin } from "@/actions/shop-order";
import { formatPrice } from "@/lib/pricing";
import { ProductOrderStatus } from "@prisma/client";

const STATUSES: { id: ProductOrderStatus | "ALL"; label: string }[] = [
  { id: "ALL", label: "All" },
  { id: "PENDING", label: "Pending" },
  { id: "CONFIRMED", label: "Confirmed" },
  { id: "FULFILLED", label: "Fulfilled" },
  { id: "CANCELLED", label: "Cancelled" },
  { id: "REFUNDED", label: "Refunded" },
];

const STATUS_COLOUR: Record<string, string> = {
  PENDING: "text-amber-300",
  CONFIRMED: "text-emerald-300",
  FULFILLED: "text-emerald-400",
  CANCELLED: "text-red-400",
  REFUNDED: "text-blue-400",
};

export default async function AdminProductOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const statusFilter = sp.status as ProductOrderStatus | "ALL" | undefined;
  const search = sp.q || undefined;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const { orders, total, totalPages } = await listOrdersForAdmin({
    status: statusFilter && statusFilter !== "ALL" ? statusFilter : undefined,
    search,
    page,
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Shop Orders</h1>
        <p className="mt-1 text-zinc-400">
          Pickup at venue. Confirm payment for UPI / cash orders, mark
          fulfilled when the customer collects.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => {
            const active = (statusFilter ?? "ALL") === s.id;
            const href = `/admin/product-orders?${new URLSearchParams({
              ...(s.id !== "ALL" ? { status: s.id } : {}),
              ...(search ? { q: search } : {}),
            }).toString()}`;
            return (
              <Link
                key={s.id}
                href={href}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                  active
                    ? "border-emerald-400 bg-emerald-500/15 text-emerald-300"
                    : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600"
                }`}
              >
                {s.label}
              </Link>
            );
          })}
        </div>
        <form className="flex items-center gap-2" action="/admin/product-orders" method="GET">
          {statusFilter && statusFilter !== "ALL" ? (
            <input type="hidden" name="status" value={statusFilter} />
          ) : null}
          <input
            name="q"
            defaultValue={search ?? ""}
            placeholder="Order number, customer, phone…"
            className="w-56 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:border-zinc-500"
          >
            Search
          </button>
        </form>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
        <table className="w-full text-sm">
          <thead className="bg-zinc-950 text-left text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-3 py-2">Order</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Items</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-right">Placed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {orders.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                  No orders match this view.
                </td>
              </tr>
            ) : null}
            {orders.map((o) => (
              <tr key={o.id} className="hover:bg-zinc-950/60">
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/product-orders/${o.id}`}
                    className="font-mono text-emerald-300 hover:underline"
                  >
                    {o.orderNumber ?? `#${o.id.slice(-6).toUpperCase()}`}
                  </Link>
                  {o.createdByAdminId ? (
                    <span className="ml-1 inline-block rounded-full border border-zinc-700 bg-zinc-800 px-1.5 text-[10px] text-zinc-400">
                      POS
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  <div className="text-white">{o.user.name ?? "—"}</div>
                  {o.user.phone ? (
                    <div className="text-xs text-zinc-500">{o.user.phone}</div>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  <span className={`text-xs font-semibold ${STATUS_COLOUR[o.status] ?? "text-zinc-300"}`}>
                    {o.status}
                  </span>
                  <div className="text-[10px] text-zinc-500">
                    {paymentMethodLabel(o.payment?.method)}
                  </div>
                </td>
                <td className="px-3 py-2 text-right text-zinc-300">
                  {o.items.reduce((s, i) => s + i.quantity, 0)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-emerald-300">
                  {formatPrice(Math.round(o.totalPaise / 100))}
                </td>
                <td className="px-3 py-2 text-right text-xs text-zinc-500">
                  {new Date(o.createdAt).toLocaleString("en-IN", {
                    dateStyle: "short",
                    timeStyle: "short",
                    timeZone: "Asia/Kolkata",
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm text-zinc-500">
          <span>
            Page {page} of {totalPages} · {total} orders
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link
                href={`/admin/product-orders?${new URLSearchParams({
                  ...(statusFilter && statusFilter !== "ALL" ? { status: statusFilter } : {}),
                  ...(search ? { q: search } : {}),
                  page: String(page - 1),
                }).toString()}`}
                className="rounded-md border border-zinc-700 px-3 py-1.5 hover:border-zinc-500"
              >
                Prev
              </Link>
            ) : null}
            {page < totalPages ? (
              <Link
                href={`/admin/product-orders?${new URLSearchParams({
                  ...(statusFilter && statusFilter !== "ALL" ? { status: statusFilter } : {}),
                  ...(search ? { q: search } : {}),
                  page: String(page + 1),
                }).toString()}`}
                className="rounded-md border border-zinc-700 px-3 py-1.5 hover:border-zinc-500"
              >
                Next
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function paymentMethodLabel(method: string | undefined | null): string {
  if (!method) return "—";
  if (method === "UPI_QR") return "UPI QR";
  return method.charAt(0) + method.slice(1).toLowerCase();
}
