import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { SPORT_INFO, SIZE_INFO, formatHoursAsRanges } from "@/lib/court-config";
import { formatPrice, formatBookingDate } from "@/lib/pricing";
import Link from "next/link";
import { ArrowLeft, Calendar, Clock, User, Receipt, MapPin, Repeat, Banknote, CheckCircle2 } from "lucide-react";
import { MarkCollectedButton } from "./mark-collected-button";
import { EditSplitButton } from "./edit-split-button";
import { AdminBookingActions } from "./admin-actions";
import { BookingEditHistory } from "@/components/admin/booking-edit-history";

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
      editHistory: { orderBy: { createdAt: "desc" } },
      recurringBooking: {
        include: {
          bookings: {
            orderBy: { date: "asc" },
            select: { id: true, date: true, status: true, totalAmount: true },
          },
        },
      },
    },
  });

  if (!booking) notFound();

  // Discount surfaces from two systems:
  //   1. Legacy DiscountCode (Booking.discountCodeId + Booking.discountAmount)
  //   2. Unified Coupon (CouponUsage with matching bookingId)
  // The legacy path updates booking.totalAmount in-place; the coupon path
  // records discount only on CouponUsage. Read both and prefer the populated one.
  const [legacyDiscountCode, couponUsage] = await Promise.all([
    booking.discountCodeId
      ? db.discountCode.findUnique({
          where: { id: booking.discountCodeId },
          select: { code: true },
        })
      : Promise.resolve(null),
    db.couponUsage.findFirst({
      where: { bookingId: booking.id },
      select: { discountAmount: true, coupon: { select: { code: true } } },
    }),
  ]);
  const discountCodeLabel =
    legacyDiscountCode?.code ?? couponUsage?.coupon.code ?? null;
  const discountAmountShown =
    booking.discountAmount > 0
      ? booking.discountAmount
      : couponUsage?.discountAmount ?? 0;

  // Fetch all court configs for the same sport (for the edit booking modal)
  const courtConfigs = await db.courtConfig.findMany({
    where: { sport: booking.courtConfig.sport, isActive: true },
    select: { id: true, label: true, size: true, position: true },
    orderBy: { position: "asc" },
  });

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
        <div className="flex items-center gap-2">
          {booking.createdByAdminId && (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-400">
              Created by Admin
            </span>
          )}
          <span
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              booking.status === "CONFIRMED"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : booking.status === "PENDING"
                ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-400"
                : "border-red-500/30 bg-red-500/10 text-red-400"
            }`}
          >
            {booking.status}
          </span>
        </div>
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
              {formatBookingDate(booking.date, {
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
              {formatHoursAsRanges(booking.slots.map((s) => s.startHour))}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400">Booking ID</span>
            <span className="font-mono text-xs text-zinc-500">{booking.id}</span>
          </div>
          {discountCodeLabel && discountAmountShown > 0 && (
            <>
              <div className="flex justify-between">
                <span className="text-zinc-400">Discount Code</span>
                <span className="font-mono text-emerald-400">{discountCodeLabel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Discount</span>
                <span className="text-emerald-400">−{formatPrice(discountAmountShown)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Recurring Series Info */}
      {booking.recurringBooking && (
        <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-5 space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-medium text-purple-400">
            <Repeat className="h-4 w-4" />
            Recurring Series
            <span className="rounded border border-purple-500/30 bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-semibold">
              {booking.recurringBooking.mode === "daily" ? "Daily" : "Weekly"}
            </span>
          </h2>
          <div className="flex flex-wrap gap-2">
            {booking.recurringBooking.bookings.map((sb) => {
              const isCurrentBooking = sb.id === booking.id;
              return (
                <Link
                  key={sb.id}
                  href={`/admin/bookings/${sb.id}`}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                    isCurrentBooking
                      ? "border-purple-400 bg-purple-500/20 text-purple-300 ring-1 ring-purple-400/50"
                      : sb.status === "CONFIRMED"
                      ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-400 hover:bg-emerald-500/10"
                      : sb.status === "CANCELLED"
                      ? "border-red-500/20 bg-red-500/5 text-red-400 hover:bg-red-500/10"
                      : "border-yellow-500/20 bg-yellow-500/5 text-yellow-400 hover:bg-yellow-500/10"
                  }`}
                >
                  {formatBookingDate(sb.date, { day: "numeric", month: "short" })}
                  {isCurrentBooking && " ← current"}
                </Link>
              );
            })}
          </div>
          <p className="text-xs text-zinc-500">
            {booking.recurringBooking.bookings.length} bookings · Total:{" "}
            {formatPrice(booking.recurringBooking.bookings.reduce((sum, b) => sum + b.totalAmount, 0))}
          </p>
        </div>
      )}

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
                    : booking.payment.status === "PARTIAL"
                    ? "text-amber-300"
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
            {booking.payment.isPartialPayment && (() => {
              const advance =
                booking.payment.advanceAmount ?? 0;
              const remaining = booking.payment.remainingAmount ?? 0;
              const total = booking.totalAmount;
              const percentPaid =
                total > 0 ? Math.round((advance / total) * 100) : 0;
              const collected = remaining <= 0;
              const borderClass = collected
                ? "border-emerald-500/30 bg-emerald-500/10"
                : "border-amber-500/30 bg-amber-500/10";
              const headerColor = collected ? "text-emerald-400" : "text-amber-400";
              const HeaderIcon = collected ? CheckCircle2 : Banknote;
              const methodLabel = (m: string) =>
                m === "UPI_QR" ? "UPI QR" : m.charAt(0) + m.slice(1).toLowerCase();
              const advanceMethodLabel = methodLabel(booking.payment.method);
              // Resolve how the remainder was collected. Prefer the
              // explicit split columns; fall back to the legacy single
              // `remainderMethod` enum for rows that predate split
              // collection.
              const venueTotal = total - advance;
              const hasSplitFields =
                booking.payment.remainderCashAmount !== null ||
                booking.payment.remainderUpiAmount !== null;
              const remainderCash = hasSplitFields
                ? booking.payment.remainderCashAmount ?? 0
                : booking.payment.remainderMethod === "CASH"
                ? venueTotal
                : 0;
              const remainderUpi = hasSplitFields
                ? booking.payment.remainderUpiAmount ?? 0
                : booking.payment.remainderMethod === "UPI_QR"
                ? venueTotal
                : 0;
              const isSplit = remainderCash > 0 && remainderUpi > 0;
              const remainderLabel = collected
                ? isSplit
                  ? `${formatPrice(remainderCash)} Cash + ${formatPrice(remainderUpi)} UPI QR`
                  : remainderCash > 0
                  ? "Cash"
                  : remainderUpi > 0
                  ? "UPI QR"
                  : booking.payment.remainderMethod
                  ? methodLabel(booking.payment.remainderMethod)
                  : null
                : null;
              return (
              <div className={`mt-2 rounded-lg border p-3 space-y-1.5 ${borderClass}`}>
                <p className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${headerColor}`}>
                  <HeaderIcon className="h-3.5 w-3.5" />
                  {collected
                    ? `Paid in Full \u00B7 ${percentPaid}% Was Advance`
                    : `${percentPaid}% Advance Booking`}
                </p>
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-400">
                    Advance paid <span className="text-zinc-500">· {advanceMethodLabel}</span>
                  </span>
                  <span className="font-semibold text-emerald-400">
                    {formatPrice(advance)}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className={collected ? "text-emerald-200" : "text-amber-200"}>
                    {collected
                      ? `Collected at venue${remainderLabel ? ` · ${remainderLabel}` : ""}`
                      : "Collect at venue"}
                  </span>
                  <span className={`font-bold ${collected ? "text-emerald-300" : "text-amber-300"}`}>
                    {formatPrice(collected ? venueTotal : remaining)}
                  </span>
                </div>
                {!collected && (
                  <MarkCollectedButton
                    bookingId={booking.id}
                    remainingAmount={remaining}
                    formattedRemaining={formatPrice(remaining)}
                  />
                )}
                {collected && venueTotal > 0 && (
                  <EditSplitButton
                    bookingId={booking.id}
                    venueTotal={venueTotal}
                    initialCash={remainderCash}
                    initialUpi={remainderUpi}
                  />
                )}
              </div>
              );
            })()}
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
        paymentAmount={booking.payment?.amount || null}
        isPartialPayment={booking.payment?.isPartialPayment ?? false}
        currentAdvanceAmount={booking.payment?.advanceAmount ?? null}
        isAdminCreated={!!booking.createdByAdminId}
        courtConfigId={booking.courtConfigId}
        date={booking.date.toISOString().split("T")[0]}
        currentSlots={booking.slots.map((s) => s.startHour)}
        sport={booking.courtConfig.sport}
        courtConfigs={courtConfigs}
      />

      {/* Edit History */}
      {booking.editHistory.length > 0 && (
        <BookingEditHistory
          history={booking.editHistory.map((h) => ({
            ...h,
            previousDate: h.previousDate?.toISOString() ?? null,
            newDate: h.newDate?.toISOString() ?? null,
            createdAt: h.createdAt.toISOString(),
          }))}
        />
      )}
    </div>
  );
}
