import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { SPORT_INFO, formatHour } from "@/lib/court-config";
import type { Sport } from "@prisma/client";
import { formatPrice, formatBookingDate } from "@/lib/pricing";
import Link from "next/link";
import { Clock, AlertTriangle, Search } from "lucide-react";
import { UnconfirmedActions } from "./unconfirmed-actions";

export default async function UnconfirmedBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireAdmin("MANAGE_BOOKINGS");
  const params = await searchParams;
  const page = parseInt(params.page || "1");
  const limit = 20;
  const skip = (page - 1) * limit;

  const where = {
    status: "PENDING" as const,
    payment: {
      status: "PENDING" as const,
      method: { in: ["UPI_QR" as const, "CASH" as const] },
    },
  };

  const [bookings, total] = await Promise.all([
    db.booking.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, phone: true } },
        courtConfig: true,
        slots: { orderBy: { startHour: "asc" } },
        payment: true,
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    db.booking.count({ where }),
  ]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-amber-500/10 p-2">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Unconfirmed Bookings</h1>
            <p className="text-sm text-zinc-400">
              {total} booking{total !== 1 ? "s" : ""} awaiting payment verification
            </p>
          </div>
        </div>
      </div>

      {bookings.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-12 text-center">
          <Search className="mx-auto h-12 w-12 text-zinc-600" />
          <p className="mt-3 text-zinc-400">No unconfirmed bookings</p>
          <p className="mt-1 text-sm text-zinc-600">All payments have been verified</p>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/80">
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Customer</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Sport / Court</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Date &amp; Time</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Amount</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Payment</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Submitted</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {bookings.map((booking) => {
                  const sportInfo = SPORT_INFO[booking.courtConfig.sport as Sport];

                  return (
                    <tr key={booking.id} className="bg-zinc-900/30 hover:bg-zinc-800/50 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium text-white truncate max-w-[140px]">
                          {booking.user.name || booking.user.phone || booking.user.email || "—"}
                        </p>
                        {booking.user.phone && (
                          <p className="text-xs text-zinc-500">{booking.user.phone}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-white">{sportInfo.name}</p>
                        <p className="text-xs text-zinc-500">{booking.courtConfig.label}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-zinc-300 whitespace-nowrap">
                          {formatBookingDate(booking.date, { day: "numeric", month: "short" })}
                        </p>
                        <p className="text-xs text-zinc-500 font-mono">
                          {booking.slots.map((s) => formatHour(s.startHour)).join(", ")}
                        </p>
                      </td>
                      <td className="px-4 py-3 font-semibold text-white whitespace-nowrap">
                        {formatPrice(booking.totalAmount)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2 py-0.5 text-[10px] font-medium text-yellow-400">
                          <Clock className="h-3 w-3" />
                          {booking.payment?.method === "CASH" ? "Cash" : "UPI QR"} · Pending
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-zinc-400 font-mono">
                          {new Date(booking.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <UnconfirmedActions
                            bookingId={booking.id}
                            paymentMethod={booking.payment?.method || "UPI_QR"}
                          />
                          <Link
                            href={`/admin/bookings/${booking.id}`}
                            className="text-xs text-zinc-400 hover:text-zinc-300"
                          >
                            Details
                          </Link>
                        </div>
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
            <Link href={`/admin/bookings/unconfirmed?page=${page - 1}`} className="rounded-lg px-3 py-1.5 text-sm bg-zinc-800 text-zinc-400 hover:bg-zinc-700">
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
                    href={`/admin/bookings/unconfirmed?page=${p}`}
                    className={`rounded-lg px-3 py-1.5 text-sm ${p === page ? "bg-emerald-500/20 text-emerald-400" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
                  >
                    {p}
                  </Link>
                </span>
              );
            })}
          {page < totalPages && (
            <Link href={`/admin/bookings/unconfirmed?page=${page + 1}`} className="rounded-lg px-3 py-1.5 text-sm bg-zinc-800 text-zinc-400 hover:bg-zinc-700">
              Next
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
