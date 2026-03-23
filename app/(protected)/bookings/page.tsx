import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { SPORT_INFO, formatHour } from "@/lib/court-config";
import { formatPrice } from "@/lib/pricing";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronRight,
} from "lucide-react";

export default async function MyBookingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const bookings = await db.booking.findMany({
    where: { userId: session.user.id },
    include: {
      courtConfig: true,
      slots: { orderBy: { startHour: "asc" } },
      payment: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const statusIcons = {
    CONFIRMED: { icon: CheckCircle2, color: "text-emerald-400", label: "Confirmed" },
    LOCKED: { icon: AlertCircle, color: "text-yellow-400", label: "Pending" },
    CANCELLED: { icon: XCircle, color: "text-red-400", label: "Cancelled" },
  };

  const upcoming = bookings.filter(
    (b) => b.status === "CONFIRMED" && b.date >= new Date()
  );
  const past = bookings.filter(
    (b) => b.status !== "CONFIRMED" || b.date < new Date()
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href="/dashboard"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
        <h1 className="text-2xl font-bold text-white">My Bookings</h1>
        <p className="mt-1 text-zinc-400">
          {bookings.length} total booking{bookings.length !== 1 ? "s" : ""}
        </p>
      </div>

      {bookings.length === 0 ? (
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
      ) : (
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
                            <p className="font-medium text-white">
                              {sportInfo.name} — {booking.courtConfig.label}
                            </p>
                            <div className="mt-1 flex items-center gap-3 text-xs text-zinc-400">
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {booking.date.toLocaleDateString("en-IN", {
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
                Past & Cancelled
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
                            <p className="text-sm text-zinc-300">
                              {sportInfo.name} — {booking.courtConfig.label}
                            </p>
                            <p className="text-xs text-zinc-500">
                              {booking.date.toLocaleDateString("en-IN", {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })}
                              {" · "}
                              {statusInfo.label}
                            </p>
                          </div>
                        </div>
                        <span className="text-sm text-zinc-500">
                          {formatPrice(booking.totalAmount)}
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
