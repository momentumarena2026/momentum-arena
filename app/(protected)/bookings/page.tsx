import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { SPORT_INFO, formatHour } from "@/lib/court-config";
import { formatPrice, formatBookingDate } from "@/lib/pricing";
import Link from "next/link";
import {
  Calendar,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import { BackButton } from "@/components/back-button";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function MyBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { filter } = await searchParams;
  const showOnlyRecurring = filter === "recurring";

  const [bookings, recurringBookings] = await Promise.all([
    db.booking.findMany({
      where: { userId: session.user.id },
      include: {
        courtConfig: true,
        slots: { orderBy: { startHour: "asc" } },
        payment: true,
        feedback: { select: { rating: true } },
        recurringBooking: { select: { id: true, dayOfWeek: true, status: true } },
      },
      orderBy: { date: "desc" },
    }),
    db.recurringBooking.findMany({
      where: {
        userId: session.user.id,
        status: { in: ["ACTIVE", "PAUSED"] },
      },
      include: {
        courtConfig: { select: { sport: true, size: true, label: true } },
        bookings: {
          where: { date: { gte: new Date() }, status: "CONFIRMED" },
          orderBy: { date: "asc" },
          take: 3,
          select: { id: true, date: true, totalAmount: true },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const statusIcons = {
    CONFIRMED: { icon: CheckCircle2, color: "text-emerald-400", label: "Confirmed" },
    LOCKED: { icon: AlertCircle, color: "text-yellow-400", label: "Pending Verification" },
    CANCELLED: { icon: XCircle, color: "text-red-400", label: "Cancelled" },
  };

  const upcoming = bookings.filter(
    (b) => (b.status === "CONFIRMED" || b.status === "LOCKED") && b.date >= new Date()
  );
  const past = bookings.filter(
    (b) => (b.status !== "CONFIRMED" && b.status !== "LOCKED") || b.date < new Date()
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <BackButton className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors" label="Back to Dashboard" />
        <h1 className="text-2xl font-bold text-white">
          {showOnlyRecurring ? "Recurring Series" : "My Bookings"}
        </h1>
        <p className="mt-1 text-zinc-400">
          {showOnlyRecurring
            ? `${recurringBookings.length} active series`
            : `${bookings.length} total booking${bookings.length !== 1 ? "s" : ""}`}
        </p>
      </div>

      {/* Recurring Bookings Section */}
      {recurringBookings.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium text-zinc-500 uppercase tracking-wider flex items-center gap-2">
            <RefreshCw className="h-3.5 w-3.5" />
            Recurring Series
          </h2>
          <div className="space-y-3">
            {recurringBookings.map((recurring) => {
              const sportInfo = SPORT_INFO[recurring.courtConfig.sport];
              return (
                <div
                  key={recurring.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-900 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="rounded-lg bg-blue-500/10 p-2 mt-0.5">
                        <RefreshCw className="h-4 w-4 text-blue-400" />
                      </div>
                      <div>
                        <p className="font-medium text-white">
                          {sportInfo.name} — {recurring.courtConfig.label}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-zinc-400">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            Every {DAY_NAMES[recurring.dayOfWeek]}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatHour(recurring.startHour)} – {formatHour(recurring.endHour)}
                          </span>
                        </div>
                        {recurring.bookings.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {recurring.bookings.map((b) => (
                              <Link
                                key={b.id}
                                href={`/book/confirmation/${b.id}`}
                                className="rounded-md bg-zinc-800 border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 hover:text-white transition-colors"
                              >
                                {formatBookingDate(b.date, {
                                  day: "numeric",
                                  month: "short",
                                })}
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-400">
                        {recurring.status}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* When filtered to recurring only, show empty state if no series */}
      {showOnlyRecurring && recurringBookings.length === 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-12 text-center">
          <RefreshCw className="mx-auto h-12 w-12 text-zinc-600" />
          <p className="mt-3 text-zinc-400">No recurring series yet</p>
          <p className="mt-1 text-sm text-zinc-600">
            Create a recurring booking when selecting your slots
          </p>
          <Link
            href="/book"
            className="mt-4 inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Book a Court
          </Link>
        </div>
      )}

      {!showOnlyRecurring && bookings.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-12 text-center">
          <Calendar className="mx-auto h-12 w-12 text-zinc-600" />
          <p className="mt-3 text-zinc-400">No bookings yet</p>
          <Link
            href="/book"
            className="mt-4 inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Book a Court
          </Link>
        </div>
      ) : !showOnlyRecurring ? (
        <div className="space-y-6">
          {upcoming.length > 0 && (
            <div>
              <h2 className="mb-3 text-sm font-medium text-zinc-500 uppercase tracking-wider">
                Upcoming
              </h2>
              <div className="space-y-3">
                {upcoming.map((booking) => {
                  const sportInfo = SPORT_INFO[booking.courtConfig.sport];
                  const statusInfo = statusIcons[booking.status];
                  const StatusIcon = statusInfo.icon;

                  return (
                    <Link
                      key={booking.id}
                      href={`/book/confirmation/${booking.id}`}
                      className="group block rounded-xl border border-zinc-800 bg-zinc-900 p-4 transition-all hover:border-zinc-700"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="rounded-lg bg-emerald-500/10 p-2">
                            <StatusIcon className={`h-5 w-5 ${statusInfo.color}`} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-white">
                                {sportInfo.name} — {booking.courtConfig.label}
                              </p>
                              {booking.recurringBooking && (
                                <span className="rounded-full bg-blue-500/10 border border-blue-500/30 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">
                                  Recurring
                                </span>
                              )}
                            </div>
                            <div className="mt-1 flex items-center gap-3 text-xs text-zinc-400">
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {formatBookingDate(booking.date, {
                                  weekday: "short",
                                  day: "numeric",
                                  month: "short",
                                })}
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {booking.slots
                                  .map((s) => formatHour(s.startHour))
                                  .join(", ")}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-emerald-400">
                            {formatPrice(booking.totalAmount)}
                          </span>
                          <ChevronRight className="h-4 w-4 text-zinc-600 group-hover:text-zinc-400" />
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {past.length > 0 && (
            <div>
              <h2 className="mb-3 text-sm font-medium text-zinc-500 uppercase tracking-wider">
                Previous
              </h2>
              <div className="space-y-3">
                {past.map((booking) => {
                  const sportInfo = SPORT_INFO[booking.courtConfig.sport];
                  const statusInfo = statusIcons[booking.status];
                  const StatusIcon = statusInfo.icon;

                  return (
                    <Link
                      key={booking.id}
                      href={`/book/confirmation/${booking.id}`}
                      className="group block rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 opacity-70 transition-all hover:opacity-100"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <StatusIcon className={`h-5 w-5 ${statusInfo.color}`} />
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm text-zinc-300">
                                {sportInfo.name} — {booking.courtConfig.label}
                              </p>
                              {booking.recurringBooking && (
                                <span className="rounded-full bg-blue-500/10 border border-blue-500/30 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">
                                  Recurring
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-zinc-500">
                              {formatBookingDate(booking.date, {
                                weekday: "short",
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })}
                              {" · "}
                              {booking.slots.map((s) => formatHour(s.startHour)).join(", ")}
                              {" · "}
                              {statusInfo.label}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-zinc-500">
                            {formatPrice(booking.totalAmount)}
                          </span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
