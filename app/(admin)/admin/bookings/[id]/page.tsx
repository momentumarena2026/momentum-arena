import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { SPORT_INFO, SIZE_INFO, formatHour } from "@/lib/court-config";
import { formatPrice } from "@/lib/pricing";
import Link from "next/link";
import { ArrowLeft, Calendar, Clock, User, Receipt, MapPin } from "lucide-react";
import { AdminBookingActions } from "./admin-actions";

export default async function AdminBookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const booking = await db.booking.findUnique({
    where: { id },
    include: {
      user: true,
      courtConfig: true,
      slots: { orderBy: { startHour: "asc" } },
      payment: true,
    },
  });

  if (!booking) notFound();

  const sportInfo = SPORT_INFO[booking.courtConfig.sport];
  const sizeInfo = SIZE_INFO[booking.courtConfig.size];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/admin/bookings"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Bookings
      </Link>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Booking Detail</h1>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-medium ${
            booking.status === "CONFIRMED"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              : booking.status === "LOCKED"
              ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-400"
              : "border-red-500/30 bg-red-500/10 text-red-400"
          }`}
        >
          {booking.status}
        </span>
      </div>

      {/* User Info */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-zinc-500">
          <User className="h-4 w-4" />
          Customer
        </h2>
        <div className="space-y-1">
          <p className="font-medium text-white">
            {booking.user.name || "—"}
          </p>
          {booking.user.email && (
            <p className="text-sm text-zinc-400">{booking.user.email}</p>
          )}
          {booking.user.phone && (
            <p className="text-sm text-zinc-400">{booking.user.phone}</p>
          )}
        </div>
      </div>

      {/* Booking Info */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-3">
        <h2 className="text-sm font-medium text-zinc-500">Booking Details</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-zinc-400 flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" /> Sport
            </span>
            <span className="text-white">{sportInfo.name} — {sizeInfo.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400">Court</span>
            <span className="text-white">{booking.courtConfig.label}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400 flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" /> Date
            </span>
            <span className="text-white">
              {booking.date.toLocaleDateString("en-IN", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> Slots
            </span>
            <span className="text-white">
              {booking.slots.map((s) => formatHour(s.startHour)).join(", ")}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400">Booking ID</span>
            <span className="font-mono text-xs text-zinc-500">{booking.id}</span>
          </div>
        </div>
      </div>

      {/* Payment Info */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-zinc-500">
          <Receipt className="h-4 w-4" />
          Payment
        </h2>
        {booking.payment ? (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-400">Method</span>
              <span className="text-white">{booking.payment.method.replace("_", " ")}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Status</span>
              <span
                className={`font-medium ${
                  booking.payment.status === "COMPLETED"
                    ? "text-emerald-400"
                    : booking.payment.status === "PENDING"
                    ? "text-yellow-400"
                    : booking.payment.status === "REFUNDED"
                    ? "text-blue-400"
                    : "text-red-400"
                }`}
              >
                {booking.payment.status}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Amount</span>
              <span className="text-lg font-bold text-white">
                {formatPrice(booking.payment.amount)}
              </span>
            </div>
            {booking.payment.razorpayPaymentId && (
              <div className="flex justify-between">
                <span className="text-zinc-400">Razorpay ID</span>
                <span className="font-mono text-xs text-zinc-500">
                  {booking.payment.razorpayPaymentId}
                </span>
              </div>
            )}
            {booking.payment.confirmedAt && (
              <div className="flex justify-between">
                <span className="text-zinc-400">Confirmed</span>
                <span className="text-zinc-300">
                  {booking.payment.confirmedAt.toLocaleString("en-IN")}
                </span>
              </div>
            )}
            {booking.payment.refundReason && (
              <div className="mt-2 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                <p className="text-xs text-blue-400">Refund Reason</p>
                <p className="text-sm text-zinc-300">{booking.payment.refundReason}</p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">No payment recorded</p>
        )}
      </div>

      {/* Admin Actions */}
      <AdminBookingActions
        bookingId={booking.id}
        bookingStatus={booking.status}
        paymentMethod={booking.payment?.method || null}
        paymentStatus={booking.payment?.status || null}
      />
    </div>
  );
}
