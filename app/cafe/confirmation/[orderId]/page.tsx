import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatPrice } from "@/lib/pricing";

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  PREPARING: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  READY: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  COMPLETED: "bg-green-500/20 text-green-400 border-green-500/30",
  CANCELLED: "bg-red-500/20 text-red-400 border-red-500/30",
};

export default async function CafeConfirmationPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const session = await auth();
  const { orderId } = await params;

  const order = await db.cafeOrder.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { cafeItem: { select: { isVeg: true } } } },
      payment: true,
    },
  });

  // Allow access if: guest order (no userId), or logged-in user's own order
  if (!order || (order.userId && session?.user?.id !== order.userId)) {
    redirect("/cafe");
  }

  const paymentMethodLabel: Record<string, string> = {
    RAZORPAY: "Online Payment",
    UPI_QR: "UPI QR",
    CASH: "Cash",
    FREE: "Free",
  };

  return (
    <div className="min-h-screen bg-black max-w-2xl mx-auto px-4 py-8">
      {/* Success icon */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-900/30 border border-emerald-700 mb-4">
          <svg
            className="w-8 h-8 text-emerald-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-white mb-1">Order Placed!</h1>
        <p className="text-zinc-400">
          Your order has been received and is being processed.
        </p>
      </div>

      {/* Order number */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-center mb-4">
        <p className="text-zinc-400 text-sm mb-1">Order Number</p>
        <p className="text-3xl font-bold text-white tracking-wider">
          {order.orderNumber}
        </p>
        <div className="mt-3">
          <span
            className={`inline-block px-3 py-1 rounded-full text-xs font-semibold border ${
              STATUS_COLORS[order.status] || STATUS_COLORS.PENDING
            }`}
          >
            {order.status}
          </span>
        </div>
      </div>

      {/* Items */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-4">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Items Ordered
        </h2>
        <div className="space-y-2">
          {order.items.map((item) => (
            <div key={item.id} className="flex justify-between text-sm">
              <div className="flex items-center gap-2 text-white">
                <span
                  className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                    item.cafeItem.isVeg ? "bg-green-500" : "bg-red-500"
                  }`}
                />
                <span>
                  {item.itemName} x{item.quantity}
                </span>
              </div>
              <span className="text-white">{formatPrice(item.totalPrice)}</span>
            </div>
          ))}
        </div>

        <div className="border-t border-zinc-800 mt-3 pt-3 space-y-1">
          {order.discountAmount > 0 && (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-400">Subtotal</span>
                <span className="text-white">
                  {formatPrice(order.originalAmount || order.totalAmount + order.discountAmount)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-emerald-400">Discount</span>
                <span className="text-emerald-400">
                  -{formatPrice(order.discountAmount)}
                </span>
              </div>
            </>
          )}
          <div className="flex justify-between font-bold">
            <span className="text-white">Total</span>
            <span className="text-white">
              {formatPrice(order.totalAmount)}
            </span>
          </div>
        </div>
      </div>

      {/* Payment info */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-6">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Payment Details
        </h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-zinc-400">Method</span>
            <span className="text-white">
              {paymentMethodLabel[order.payment?.method || ""] ||
                order.payment?.method}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400">Status</span>
            <span
              className={
                order.payment?.status === "COMPLETED"
                  ? "text-emerald-400"
                  : "text-yellow-400"
              }
            >
              {order.payment?.status || "PENDING"}
            </span>
          </div>
          {order.payment?.razorpayPaymentId && (
            <div className="flex justify-between">
              <span className="text-zinc-400">Payment ID</span>
              <span className="text-white text-xs font-mono">
                {order.payment.razorpayPaymentId}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3">
        <a
          href={`/api/cafe-invoice?orderId=${order.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white font-semibold py-3 rounded-xl text-center transition-colors flex items-center justify-center gap-2"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          Download Invoice
        </a>
        <Link
          href="/cafe"
          className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 rounded-xl text-center transition-colors"
        >
          Back to Menu
        </Link>
      </div>
    </div>
  );
}
