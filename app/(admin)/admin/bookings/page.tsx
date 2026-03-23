import { getAdminBookings } from "@/actions/admin-booking";
import { SPORT_INFO, formatHour } from "@/lib/court-config";
import { formatPrice } from "@/lib/pricing";
import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  XCircle,
  ChevronRight,
  Search,
} from "lucide-react";

export default async function AdminBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; sport?: string; date?: string }>;
}) {
  const params = await searchParams;
  const page = parseInt(params.page || "1");

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">All Bookings</h1>
          <p className="mt-1 text-zinc-400">{total} total bookings</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {["", "CONFIRMED", "LOCKED", "CANCELLED"].map((status) => (
          <Link
            key={status}
            href={`/admin/bookings?status=${status}&sport=${params.sport || ""}&date=${params.date || ""}`}
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

      {/* Bookings List */}
      {bookings.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-12 text-center">
          <Search className="mx-auto h-12 w-12 text-zinc-600" />
          <p className="mt-3 text-zinc-400">No bookings found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {bookings.map((booking) => {
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
                    <StatusIcon className={`h-4 w-4 ${statusInfo.color}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-white truncate">
                        {booking.user.name || booking.user.email || booking.user.phone}
                      </p>
                      {booking.payment && (
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] ${
                            paymentStatusColors[booking.payment.status]
                          }`}
                        >
                          {booking.payment.status} • {booking.payment.method.replace("_", " ")}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {sportInfo.name} — {booking.courtConfig.label} •{" "}
                      {booking.date.toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                      })}{" "}
                      •{" "}
                      {booking.slots.map((s) => formatHour(s.startHour)).join(", ")}
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
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <Link
              key={p}
              href={`/admin/bookings?page=${p}&status=${params.status || ""}`}
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
}
