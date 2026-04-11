import { DateFilterInput } from "@/components/admin/date-filter-input";
import { getAdminBookings } from "@/actions/admin-booking";
import { SPORT_INFO, formatHour } from "@/lib/court-config";
import type { Sport } from "@prisma/client";
import { formatPrice, formatBookingDate } from "@/lib/pricing";
import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  XCircle,
  Search,
  Calendar,
  Plus,
} from "lucide-react";

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
  const { getTodayIST } = await import("@/lib/ist-date");
  const today = getTodayIST();

  const { bookings, total, totalPages } = await getAdminBookings({
    page,
    status: params.status,
    sport: params.sport,
    date: params.date,
    limit: 20,
  });

  const statusIcons = {
    CONFIRMED: { icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10", label: "Confirmed" },
    LOCKED: { icon: Clock, color: "text-yellow-400", bg: "bg-yellow-500/10", label: "Locked" },
    CANCELLED: { icon: XCircle, color: "text-red-400", bg: "bg-red-500/10", label: "Cancelled" },
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">All Bookings</h1>
          <p className="mt-1 text-sm text-zinc-400">{total} total bookings</p>
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
          <Link href={filterUrl({ date: "" })} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${!params.date ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"}`}>
            All Dates
          </Link>
          <Link href={filterUrl({ date: today })} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${params.date === today ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"}`}>
            Today
          </Link>
          <Link href={filterUrl({ date: new Date(Date.now() + 86400000).toISOString().split("T")[0] })} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${params.date === new Date(Date.now() + 86400000).toISOString().split("T")[0] ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"}`}>
            Tomorrow
          </Link>
          <DateFilterInput currentDate={params.date || ""} status={params.status || ""} sport={params.sport || ""} />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-zinc-400">Status:</span>
          {["", "CONFIRMED", "LOCKED", "CANCELLED"].map((status) => (
            <Link key={status} href={filterUrl({ status })} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${(params.status || "") === status ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"}`}>
              {status || "All"}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-zinc-400">Sport:</span>
          <Link href={filterUrl({ sport: "" })} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${!params.sport ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"}`}>
            All
          </Link>
          {sports.map((sport) => (
            <Link key={sport} href={filterUrl({ sport })} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${params.sport === sport ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"}`}>
              {SPORT_INFO[sport as Sport]?.name || sport}
            </Link>
          ))}
        </div>
      </div>

      {/* Bookings Table */}
      {bookings.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-12 text-center">
          <Search className="mx-auto h-12 w-12 text-zinc-600" />
          <p className="mt-3 text-zinc-400">No bookings found</p>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/80">
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Customer</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Sport / Court</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Slots</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Amount</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Payment</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {bookings.map((booking) => {
                  const sportInfo = SPORT_INFO[booking.courtConfig.sport];
                  const statusInfo = statusIcons[booking.status];
                  const StatusIcon = statusInfo.icon;

                  return (
                    <tr key={booking.id} className="bg-zinc-900/30 hover:bg-zinc-800/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-white truncate max-w-[140px]">
                            {booking.user.name || booking.user.phone || booking.user.email || "—"}
                          </span>
                          {booking.createdByAdminId && (
                            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400 shrink-0">
                              Admin
                            </span>
                          )}
                        </div>
                        {booking.user.phone && (
                          <p className="text-xs text-zinc-500 mt-0.5">{booking.user.phone}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-white">{sportInfo.name}</p>
                        <p className="text-xs text-zinc-500">{booking.courtConfig.label}</p>
                      </td>
                      <td className="px-4 py-3 text-zinc-300 whitespace-nowrap">
                        {formatBookingDate(booking.date, { day: "numeric", month: "short", year: "numeric" })}
                      </td>
                      <td className="px-4 py-3 text-zinc-300 font-mono text-xs">
                        {booking.slots.map((s) => formatHour(s.startHour)).join(", ")}
                      </td>
                      <td className="px-4 py-3 font-semibold text-white whitespace-nowrap">
                        {formatPrice(booking.totalAmount)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${statusInfo.bg} ${statusInfo.color}`}>
                          <StatusIcon className="h-3 w-3" />
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {booking.payment ? (
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${paymentStatusColors[booking.payment.status]}`}>
                            {booking.payment.status} · {booking.payment.method.replace("_", " ")}
                          </span>
                        ) : (
                          <span className="text-xs text-zinc-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/admin/bookings/${booking.id}`}
                          className="text-xs text-emerald-400 hover:text-emerald-300 font-medium"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          {page > 1 && (
            <Link href={filterUrl({ page: (page - 1).toString() })} className="rounded-lg px-3 py-1.5 text-sm bg-zinc-800 text-zinc-400 hover:bg-zinc-700">
              Prev
            </Link>
          )}
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
            .map((p, idx, arr) => {
              const prev = arr[idx - 1];
              const showEllipsis = prev && p - prev > 1;
              return (
                <span key={p} className="contents">
                  {showEllipsis && <span className="px-2 text-zinc-600">...</span>}
                  <Link
                    href={filterUrl({ page: p.toString() })}
                    className={`rounded-lg px-3 py-1.5 text-sm ${p === page ? "bg-emerald-500/20 text-emerald-400" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
                  >
                    {p}
                  </Link>
                </span>
              );
            })}
          {page < totalPages && (
            <Link href={filterUrl({ page: (page + 1).toString() })} className="rounded-lg px-3 py-1.5 text-sm bg-zinc-800 text-zinc-400 hover:bg-zinc-700">
              Next
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
