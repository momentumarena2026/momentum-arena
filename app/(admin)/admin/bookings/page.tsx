import { DateFilterInput } from "@/components/admin/date-filter-input";
import { getAdminBookings } from "@/actions/admin-booking";
import { getCalendarData } from "@/actions/admin-calendar";
import { SPORT_INFO, formatHour } from "@/lib/court-config";
import type { Sport } from "@prisma/client";
import { formatPrice, formatBookingDate } from "@/lib/pricing";
import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  XCircle,
  ChevronRight,
  Search,
  Calendar,
  Plus,
} from "lucide-react";
import { BookingsPageWrapper } from "./bookings-page-wrapper";

export default async function AdminBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    status?: string;
    sport?: string;
    date?: string;
  }>;
}) {
  const params = await searchParams;
  const page = parseInt(params.page || "1");
  const today = new Date().toISOString().split("T")[0];

  // Fetch both list data and calendar data in parallel
  const [listData, calendarData] = await Promise.all([
    getAdminBookings({
      page,
      status: params.status,
      sport: params.sport,
      date: params.date,
      limit: 20,
    }),
    getCalendarData(today),
  ]);

  const { bookings, total, totalPages } = listData;

  const statusIcons = {
    CONFIRMED: {
      icon: CheckCircle2,
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
      label: "Confirmed",
    },
    LOCKED: {
      icon: Clock,
      color: "text-yellow-400",
      bg: "bg-yellow-500/10",
      label: "Locked",
    },
    CANCELLED: {
      icon: XCircle,
      color: "text-red-400",
      bg: "bg-red-500/10",
      label: "Cancelled",
    },
  };

  const paymentStatusColors: Record<string, string> = {
    PENDING: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
    COMPLETED: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
    REFUNDED: "text-blue-400 bg-blue-500/10 border-blue-500/30",
    FAILED: "text-red-400 bg-red-500/10 border-red-500/30",
  };

  const sports = ["CRICKET", "FOOTBALL", "PICKLEBALL", "BADMINTON"];

  function filterUrl(overrides: Record<string, string>) {
    const base: Record<string, string> = {
      status: params.status || "",
      sport: params.sport || "",
      date: params.date || "",
      page: "1",
    };
    const merged = { ...base, ...overrides };
    const qs = Object.entries(merged)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");
    return `/admin/bookings${qs ? `?${qs}` : ""}`;
  }

  // Group bookings by date for list view
  const groupedByDate = new Map<string, typeof bookings>();
  for (const b of bookings) {
    const dateKey = formatBookingDate(b.date, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    if (!groupedByDate.has(dateKey)) groupedByDate.set(dateKey, []);
    groupedByDate.get(dateKey)!.push(b);
  }

  for (const [, group] of groupedByDate) {
    group.sort((a, b) => {
      const aHour = a.slots[0]?.startHour ?? 99;
      const bHour = b.slots[0]?.startHour ?? 99;
      return aHour - bHour;
    });
  }

  // List view content (passed as children to wrapper)
  const listViewContent = (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">All Bookings</h1>
          <p className="mt-1 text-zinc-400">{total} total bookings</p>
        </div>
        <Link
          href="/admin/bookings/create"
          className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Create Booking
        </Link>
      </div>

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <Calendar className="h-4 w-4" />
            <span>Date:</span>
          </div>
          <Link
            href={filterUrl({ date: "" })}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              !params.date
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"
            }`}
          >
            All Dates
          </Link>
          <Link
            href={filterUrl({ date: today })}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              params.date === today
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"
            }`}
          >
            Today
          </Link>
          <Link
            href={filterUrl({
              date: new Date(Date.now() + 86400000).toISOString().split("T")[0],
            })}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              params.date ===
              new Date(Date.now() + 86400000).toISOString().split("T")[0]
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"
            }`}
          >
            Tomorrow
          </Link>
          <DateFilterInput
            currentDate={params.date || ""}
            status={params.status || ""}
            sport={params.sport || ""}
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-zinc-400">Status:</span>
          {["", "CONFIRMED", "LOCKED", "CANCELLED"].map((status) => (
            <Link
              key={status}
              href={filterUrl({ status })}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                (params.status || "") === status
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"
              }`}
            >
              {status || "All"}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-zinc-400">Sport:</span>
          <Link
            href={filterUrl({ sport: "" })}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              !params.sport
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"
            }`}
          >
            All
          </Link>
          {sports.map((sport) => (
            <Link
              key={sport}
              href={filterUrl({ sport })}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                params.sport === sport
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"
              }`}
            >
              {SPORT_INFO[sport as Sport]?.name || sport}
            </Link>
          ))}
        </div>
      </div>

      {/* Bookings list */}
      {bookings.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-12 text-center">
          <Search className="mx-auto h-12 w-12 text-zinc-600" />
          <p className="mt-3 text-zinc-400">No bookings found</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Array.from(groupedByDate.entries()).map(
            ([dateLabel, dateBookings]) => (
              <div key={dateLabel}>
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="h-4 w-4 text-emerald-400" />
                  <h3 className="text-sm font-semibold text-emerald-400">
                    {dateLabel}
                  </h3>
                  <span className="text-xs text-zinc-500">
                    ({dateBookings.length} booking
                    {dateBookings.length !== 1 ? "s" : ""})
                  </span>
                </div>
                <div className="space-y-2">
                  {dateBookings.map((booking) => {
                    const sportInfo = SPORT_INFO[booking.courtConfig.sport];
                    const statusInfo = statusIcons[booking.status];
                    const StatusIcon = statusInfo.icon;

                    return (
                      <Link
                        key={booking.id}
                        href={`/admin/bookings/${booking.id}`}
                        className="group flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 p-4 transition-all hover:border-zinc-700"
                      >
                        <div className="flex items-center gap-4 flex-1 min-w-0">
                          <div className={`rounded-lg ${statusInfo.bg} p-2`}>
                            <StatusIcon
                              className={`h-4 w-4 ${statusInfo.color}`}
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium text-white truncate">
                                {booking.user.name ||
                                  booking.user.email ||
                                  booking.user.phone}
                              </p>
                              {booking.createdByAdminId && (
                                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                                  Admin
                                </span>
                              )}
                              {booking.payment && (
                                <span
                                  className={`rounded-full border px-2 py-0.5 text-[10px] ${
                                    paymentStatusColors[booking.payment.status]
                                  }`}
                                >
                                  {booking.payment.status} •{" "}
                                  {booking.payment.method.replace("_", " ")}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-zinc-500 mt-0.5">
                              {sportInfo.name} — {booking.courtConfig.label} •{" "}
                              <span className="text-zinc-300 font-medium">
                                {booking.slots
                                  .map((s) => formatHour(s.startHour))
                                  .join(", ")}
                              </span>
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 ml-4">
                          <span className="text-sm font-semibold text-white">
                            {formatPrice(booking.totalAmount)}
                          </span>
                          <ChevronRight className="h-4 w-4 text-zinc-600 group-hover:text-zinc-400" />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )
          )}
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
                p === page
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

  return (
    <BookingsPageWrapper
      calendarData={calendarData}
      calendarDate={today}
      listViewContent={listViewContent}
    />
  );
}
