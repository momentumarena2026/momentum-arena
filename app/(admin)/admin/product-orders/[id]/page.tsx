import Link from "next/link";
import { notFound } from "next/navigation";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { formatPrice } from "@/lib/pricing";
import { OrderActions } from "./order-actions";

export const dynamic = "force-dynamic";

export default async function AdminProductOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin("MANAGE_SHOP_ORDERS");
  const { id } = await params;

  const order = await db.productOrder.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, phone: true, email: true } },
      items: { include: { product: true } },
      payment: true,
    },
  });
  if (!order) return notFound();

  return (
    <div className="space-y-5">
      <Link
        href="/admin/product-orders"
        className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-white"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to orders
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">
            {order.orderNumber ?? `#${order.id.slice(-6).toUpperCase()}`}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {new Date(order.createdAt).toLocaleString("en-IN", {
              dateStyle: "long",
              timeStyle: "short",
              timeZone: "Asia/Kolkata",
            })}
            {order.createdByAdminId ? " · Walk-in (POS)" : ""}
          </p>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-semibold ${
            order.status === "CONFIRMED" || order.status === "FULFILLED"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : order.status === "PENDING"
                ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                : order.status === "REFUNDED"
                  ? "border-blue-500/40 bg-blue-500/10 text-blue-300"
                  : "border-red-500/40 bg-red-500/10 text-red-300"
          }`}
        >
          {order.status}
        </span>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Customer
        </h2>
        <p className="font-medium text-white">{order.user.name ?? "—"}</p>
        {order.user.phone ? (
          <p className="text-sm text-zinc-400">{order.user.phone}</p>
        ) : null}
        {order.user.email ? (
          <p className="text-sm text-zinc-400">{order.user.email}</p>
        ) : null}
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Items
        </h2>
        <ul className="divide-y divide-zinc-800">
          {order.items.map((line) => (
            <li key={line.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-md bg-zinc-800">
                {line.product.imageUrl ? (
                  <Image
                    src={line.product.imageUrl}
                    alt={line.nameSnapshot}
                    fill
                    sizes="48px"
                    className="object-cover"
                    unoptimized
                  />
                ) : null}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-white">{line.nameSnapshot}</p>
                <p className="text-xs text-zinc-500">
                  {formatPrice(Math.round(line.priceEachPaise / 100))} × {line.quantity}
                </p>
              </div>
              <p className="font-mono text-sm text-emerald-300">
                {formatPrice(Math.round((line.priceEachPaise * line.quantity) / 100))}
              </p>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-center justify-between border-t border-zinc-800 pt-3">
          <span className="text-sm font-semibold text-white">Total</span>
          <span className="text-lg font-bold text-emerald-300">
            {formatPrice(Math.round(order.totalPaise / 100))}
          </span>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Payment
        </h2>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-zinc-500">Method</dt>
          <dd className="text-right text-zinc-200">
            {paymentMethodLabel(order.payment?.method)}
          </dd>
          <dt className="text-zinc-500">Status</dt>
          <dd className="text-right text-zinc-200">{order.payment?.status ?? "—"}</dd>
          {order.payment?.razorpayPaymentId ? (
            <>
              <dt className="text-zinc-500">Razorpay ID</dt>
              <dd className="text-right font-mono text-xs text-zinc-400">
                {order.payment.razorpayPaymentId}
              </dd>
            </>
          ) : null}
          {order.payment?.utrNumber ? (
            <>
              <dt className="text-zinc-500">UTR</dt>
              <dd className="text-right font-mono text-xs text-zinc-400">
                {order.payment.utrNumber}
              </dd>
            </>
          ) : null}
        </dl>
      </div>

      {/* Admin actions — confirm/fulfill/cancel. Wraps the server
          actions in a small client component so we get loading state
          + confirmation modals without server-side complexity. */}
      <OrderActions
        orderId={order.id}
        status={order.status}
        paymentMethod={order.payment?.method ?? "RAZORPAY"}
        paymentStatus={order.payment?.status ?? "PENDING"}
        hasUtr={!!order.payment?.utrNumber}
      />
    </div>
  );
}

function paymentMethodLabel(method: string | undefined | null): string {
  if (!method) return "—";
  if (method === "UPI_QR") return "UPI QR";
  return method.charAt(0) + method.slice(1).toLowerCase();
}
