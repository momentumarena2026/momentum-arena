import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, Clock, QrCode, Wallet } from "lucide-react";
import { auth } from "@/lib/auth";
import { getOrderForCustomer } from "@/actions/shop-order";
import { formatPrice } from "@/lib/pricing";
import { CancelOrderButton } from "./cancel-button";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return notFound();
  }
  const order = await getOrderForCustomer(id);
  if (!order) return notFound();

  const status = order.status;
  const isPending = status === "PENDING";
  const isConfirmed = status === "CONFIRMED";
  const isFulfilled = status === "FULFILLED";

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 sm:py-8">
      <Link
        href="/shop"
        className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-white"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to shop
      </Link>

      <div className="mt-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">
            Order {order.orderNumber ?? `#${order.id.slice(-6).toUpperCase()}`}
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            {new Date(order.createdAt).toLocaleString("en-IN", {
              dateStyle: "long",
              timeStyle: "short",
              timeZone: "Asia/Kolkata",
            })}
          </p>
        </div>
        <StatusPill status={status} />
      </div>

      {/* Status banner */}
      <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        {isPending ? (
          order.payment?.method === "RAZORPAY" ? (
            <BannerLine icon={Clock} tone="amber">
              Awaiting payment. If your Razorpay window closed, the order
              will auto-cancel and stock will be released.
            </BannerLine>
          ) : order.payment?.method === "UPI_QR" ? (
            <BannerLine icon={QrCode} tone="amber">
              Scan the UPI QR at the counter and share the UTR with the
              attendant, or call the venue to confirm payment. We'll mark
              the order paid once verified.
            </BannerLine>
          ) : (
            <BannerLine icon={Wallet} tone="amber">
              Pay in cash at the venue when you collect. Order is held until
              then.
            </BannerLine>
          )
        ) : null}
        {isConfirmed ? (
          <BannerLine icon={CheckCircle2} tone="emerald">
            Payment confirmed. Visit the front desk to collect your order.
          </BannerLine>
        ) : null}
        {isFulfilled ? (
          <BannerLine icon={CheckCircle2} tone="emerald">
            Order picked up{" "}
            {order.fulfilledAt
              ? new Date(order.fulfilledAt).toLocaleDateString("en-IN")
              : ""}
            . Thank you!
          </BannerLine>
        ) : null}
        {(status === "CANCELLED" || status === "REFUNDED") && (
          <BannerLine icon={Clock} tone="red">
            Order {status.toLowerCase()}
            {order.cancelReason ? ` — ${order.cancelReason}` : ""}.
          </BannerLine>
        )}
      </div>

      {/* Items */}
      <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Items
        </h2>
        <ul className="divide-y divide-zinc-800">
          {order.items.map((line) => (
            <li
              key={line.id}
              className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
            >
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
                <p className="text-sm font-medium text-white">
                  {line.nameSnapshot}
                </p>
                <p className="text-xs text-zinc-500">
                  {formatPrice(Math.round(line.priceEachPaise / 100))} ×{" "}
                  {line.quantity}
                </p>
              </div>
              <p className="text-sm font-mono text-emerald-300">
                {formatPrice(
                  Math.round((line.priceEachPaise * line.quantity) / 100),
                )}
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

      {/* Payment */}
      <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Payment
        </h2>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-zinc-500">Method</dt>
          <dd className="text-right text-zinc-200">
            {paymentMethodLabel(order.payment?.method)}
          </dd>
          <dt className="text-zinc-500">Status</dt>
          <dd className="text-right text-zinc-200">
            {order.payment?.status ?? "—"}
          </dd>
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

      {isPending ? (
        <div className="mt-5">
          <CancelOrderButton orderId={order.id} />
        </div>
      ) : null}
    </main>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    PENDING: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    CONFIRMED: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    FULFILLED: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    CANCELLED: "border-red-500/40 bg-red-500/10 text-red-300",
    REFUNDED: "border-blue-500/40 bg-blue-500/10 text-blue-300",
  };
  return (
    <span
      className={`rounded-full border px-3 py-1 text-xs font-semibold ${
        map[status] ?? "border-zinc-700 text-zinc-300"
      }`}
    >
      {status}
    </span>
  );
}

function BannerLine({
  icon: Icon,
  tone,
  children,
}: {
  icon: typeof CheckCircle2;
  tone: "emerald" | "amber" | "red";
  children: React.ReactNode;
}) {
  const color =
    tone === "emerald"
      ? "text-emerald-300"
      : tone === "amber"
        ? "text-amber-300"
        : "text-red-300";
  return (
    <div className={`flex items-start gap-2 text-sm ${color}`}>
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <p>{children}</p>
    </div>
  );
}

function paymentMethodLabel(method: string | undefined | null): string {
  if (!method) return "—";
  if (method === "UPI_QR") return "UPI QR";
  return method.charAt(0) + method.slice(1).toLowerCase();
}
