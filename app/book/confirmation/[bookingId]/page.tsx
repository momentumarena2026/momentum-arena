import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect, notFound } from "next/navigation";
import { SPORT_INFO, SIZE_INFO, formatHour } from "@/lib/court-config";
import { formatPrice, formatBookingDate } from "@/lib/pricing";
import { CalendarExport } from "./calendar-export";
import { BookingQR } from "./booking-qr";
import { ConfirmationTracker } from "./confirmation-tracker";
import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  XCircle,
  Calendar,
  MapPin,
  Receipt,
  ArrowRight,
  Download,
  RefreshCw,
} from "lucide-react";

export default async function ConfirmationPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { bookingId } = await params;

  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  const booking = await db.booking.findUnique({
    where: { id: bookingId, userId: session.user.id },
    include: {
      courtConfig: true,
      slots: { orderBy: { startHour: "asc" } },
      payment: true,
      recurringBooking: {
        select: {
          id: true,
          dayOfWeek: true,
          startDate: true,
          endDate: true,
          status: true,
          startHour: true,
          endHour: true,
          _count: { select: { bookings: true } },
        },
      },
    },
  });
  // qrToken is on the booking model directly

  if (!booking) notFound();

  const sportInfo = SPORT_INFO[booking.courtConfig.sport];
  const sizeInfo = SIZE_INFO[booking.courtConfig.size];

  // Determine if this is a UPI QR or Cash booking awaiting admin verification
  const isAwaitingVerification =
    booking.status === "LOCKED" &&
    booking.payment?.status === "PENDING" &&
    (booking.payment?.method === "UPI_QR" || booking.payment?.method === "CASH");

  const statusConfig = {
    CONFIRMED: {
      icon: CheckCircle2,
      color: "text-emerald-400",
      bg: "bg-emerald-500/10 border-emerald-500/30",
      title: "Booking Confirmed!",
      subtitle: "Your court has been reserved successfully.",
    },
    LOCKED: {
      icon: Clock,
      color: "text-yellow-400",
      bg: "bg-yellow-500/10 border-yellow-500/30",
      title: isAwaitingVerification
        ? "Payment Verification Pending"
        : "Awaiting Payment",
      subtitle: isAwaitingVerification
        ? "Your slot is held. Once our team verifies your payment, the booking will be confirmed."
        : "Complete payment to confirm your booking.",
    },
    CANCELLED: {
      icon: XCircle,
      color: "text-red-400",
      bg: "bg-red-500/10 border-red-500/30",
      title: "Booking Cancelled",
      subtitle: booking.payment?.refundReason
        ? `Reason: ${booking.payment.refundReason}`
        : "This booking has been cancelled.",
    },
  };

  const status = statusConfig[booking.status];
  const StatusIcon = status.icon;

  const paymentLabel: Record<string, string> = {
    RAZORPAY: "Online (Razorpay)",
    UPI_QR: "UPI QR",
    CASH: "Cash at Venue",
    FREE: "Complimentary",
  };

  const paymentStatusLabel = {
    PENDING: { text: "Pending", color: "text-yellow-400" },
    COMPLETED: { text: "Paid", color: "text-emerald-400" },
    REFUNDED: { text: "Refunded", color: "text-blue-400" },
    FAILED: { text: "Failed", color: "text-red-400" },
  };

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <ConfirmationTracker bookingId={booking.id} status={booking.status} />
      {/* Status Header */}
      <div className={`rounded-2xl border p-6 text-center ${status.bg}`}>
        <StatusIcon className={`mx-auto h-12 w-12 ${status.color}`} />
        <h1 className="mt-3 text-xl font-bold text-white">{status.title}</h1>
        <p className="mt-1 text-sm text-zinc-400">{status.subtitle}</p>
      </div>

      {/* Booking Details */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>Booking ID</span>
          <span className="font-mono">{booking.id}</span>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-zinc-800 p-2">
              <Calendar className="h-4 w-4 text-zinc-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">
                {formatBookingDate(booking.date, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </p>
              <p className="text-xs text-zinc-400">
                {booking.slots.map((s) => formatHour(s.startHour)).join(", ")}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-zinc-800 p-2">
              <MapPin className="h-4 w-4 text-zinc-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">
                {sportInfo.name}
              </p>
              <p className="text-xs text-zinc-400">{booking.courtConfig.label}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-zinc-800 p-2">
              <Receipt className="h-4 w-4 text-zinc-400" />
            </div>
            <div className="flex-1 space-y-1">
              {booking.originalAmount && booking.discountAmount > 0 && (
                <>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-500">Original</span>
                    <span className="text-zinc-500 line-through">{formatPrice(booking.originalAmount)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-emerald-400">Discount</span>
                    <span className="text-emerald-400">-{formatPrice(booking.discountAmount)}</span>
                  </div>
                </>
              )}
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-white">
                  {formatPrice(booking.totalAmount)}
                </p>
                {booking.payment && (
                  <span className={`text-xs ${paymentStatusLabel[booking.payment.status].color}`}>
                    {paymentStatusLabel[booking.payment.status].text}
                  </span>
                )}
              </div>
              {booking.payment?.isPartialPayment && booking.payment.advanceAmount && (
                <div className="space-y-0.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-emerald-400">Advance Paid</span>
                    <span className="text-emerald-400">{formatPrice(booking.payment.advanceAmount)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-yellow-400">Due at Venue</span>
                    <span className="text-yellow-400">{formatPrice(booking.payment.remainingAmount || 0)}</span>
                  </div>
                </div>
              )}
              {booking.payment && (
                <p className="text-xs text-zinc-400">
                  via {paymentLabel[booking.payment.method]}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Recurring Booking Info */}
      {booking.recurringBooking && (
        <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-blue-400" />
            <h3 className="text-sm font-semibold text-blue-400">Part of Recurring Series</h3>
          </div>
          <div className="ml-6 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-400">Repeats every</span>
              <span className="text-white">{DAY_NAMES[booking.recurringBooking.dayOfWeek]}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Time</span>
              <span className="text-white">
                {formatHour(booking.recurringBooking.startHour)} – {formatHour(booking.recurringBooking.endHour)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Total bookings in series</span>
              <span className="text-white">{booking.recurringBooking._count.bookings}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Series status</span>
              <span className={`font-medium ${
                booking.recurringBooking.status === "ACTIVE" ? "text-emerald-400" :
                booking.recurringBooking.status === "CANCELLED" ? "text-red-400" : "text-yellow-400"
              }`}>
                {booking.recurringBooking.status}
              </span>
            </div>
          </div>
          <Link
            href="/bookings"
            className="ml-6 mt-1 inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            View all recurring bookings
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      )}

      {/* Download Invoice */}
      {booking.status === "CONFIRMED" && booking.payment?.status === "COMPLETED" && (
        <a
          href={`/api/invoice?bookingId=${booking.id}`}
          className="flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-400 transition-colors hover:bg-emerald-500/20"
        >
          <Download className="h-4 w-4" />
          Download Invoice (GST)
        </a>
      )}

      {/* QR Check-in */}
      {booking.status === "CONFIRMED" && booking.qrToken && (
        <BookingQR qrToken={booking.qrToken} bookingId={booking.id} />
      )}

      {/* Calendar Export */}
      {booking.status === "CONFIRMED" && booking.slots.length > 0 && (
        <CalendarExport
          bookingId={booking.id}
          bookingDate={booking.date}
          startHour={booking.slots[0].startHour}
          endHour={booking.slots[booking.slots.length - 1].startHour + 1}
          sport={SPORT_INFO[booking.courtConfig.sport].name}
          courtLabel={booking.courtConfig.label}
          totalAmount={booking.totalAmount}
        />
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <Link
          href="/bookings"
          className="flex-1 rounded-xl border border-zinc-700 px-4 py-3 text-center text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800"
        >
          My Bookings
        </Link>
        <Link
          href="/book"
          className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-center text-sm font-medium text-white transition-colors hover:bg-emerald-700"
        >
          Book Another
          <ArrowRight className="ml-1 inline h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
