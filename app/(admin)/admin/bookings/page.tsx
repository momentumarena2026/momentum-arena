import { DateFilterInput } from "@/components/admin/date-filter-input";
import { getAdminBookings, getAdminStats } from "@/actions/admin-booking";
import { SPORT_INFO } from "@/lib/court-config";
import type { Sport } from "@prisma/client";
import { formatPrice } from "@/lib/pricing";
import { getTodayIST } from "@/lib/ist-date";
import Link from "next/link";
import {
  Calendar,
  Plus,
  Search,
  TrendingUp,
  CalendarCheck,
  IndianRupee,
  Clock,
} from "lucide-react";
import { BookingsTable } from "./bookings-table";

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
  const today = getTodayIST();

  // Default to CONFIRMED if no status filter is set
  const activeStatus = params.status ?? "CONFIRMED";

  const [{ bookings, total, totalPages }, stats] = await Promise.all([
    getAdminBookings({
      page,
      status: activeStatus === "ALL" ? undefined : activeStatus,
      sport: params.sport,
      date: params.date,
      limit: 20,
    }),
    getAdminStats(),
  ]);

  const sports = ["CRICKET", "FOOTBALL", "PICKLEBALL", "BADMINTON"];

  const sportInfoMap: Record<string, { name: string; icon: string }> = {};
  for (const key of sports) {
    const info = SPORT_INFO[key as Sport];
    if (info) sportInfoMap[key] = { name: info.name, icon: "" };
  }

  function filterUrl(overrides: Record<string, string>) {
    const base: Record<string, string> = {
      status: activeStatus || "",
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

  const statCards = [
    {
      label: "Total Bookings",
      value: stats.totalBookings.toLocaleString(),
      icon: TrendingUp,
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
      border: "border-emerald-500/20",
    },
    {
      label: "Today's Bookings",
      value: stats.todayBookings.toString(),
      icon: CalendarCheck,
      color: "text-blue-400",
      bg: "bg-blue-500/10",
      border: "border-blue-500/20",
    },
    {
      label: "Today's Revenue",
      value: formatPrice(stats.todayRevenue),
      icon: IndianRupee,
      color: "text-yellow-400",
      bg: "bg-yellow-500/10",
      border: "border-yellow-500/20",
    },
    {
      label: "Pending Payments",
      value: stats.pendingPayments.toString(),
      icon: Clock,
      color: "text-orange-400",
      bg: "bg-orange-500/10",
      border: "border-orange-500/20",
    },
  ];

  const activeFilters = [params.status, params.sport, params.date].filter(Boolean).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Bookings</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {total} {params.status || params.sport || params.date ? "filtered" : "total"} bookings
          </p>
        </div>
        <Link
          href="/admin/bookings/create"
          className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 transition-colors shadow-lg shadow-emerald-900/20"
        >
          <Plus className="h-4 w-4" />
          New Booking
        </Link>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className={`rounded-xl border ${stat.border} bg-zinc-900/50 p-4 space-y-2`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-500">{stat.label}</span>
                <div className={`rounded-lg ${stat.bg} p-1.5`}>
                  <Icon className={`h-3.5 w-3.5 ${stat.color}`} />
                </div>
              </div>
              <p className={`text-xl font-bold ${stat.color}`}>{stat.value}</p>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-medium text-zinc-400 uppercase tracking-wider">
            <Calendar className="h-3.5 w-3.5" />
            Filters
            {activeFilters > 0 && (
              <span className="rounded-full bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 text-[10px] font-bold">
                {activeFilters}
              </span>
            )}
          </div>
          {activeFilters > 0 && (
            <Link href="/admin/bookings" className="text-[10px] text-zinc-500 hover:text-white transition-colors uppercase tracking-wider">
              Clear all
            </Link>
          )}
        </div>

        {/* Date row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-zinc-600 uppercase tracking-wider font-semibold w-12">Date</span>
          {[
            { label: "All", value: "" },
            { label: "Today", value: today },
            { label: "Tomorrow", value: new Date(Date.now() + 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) },
          ].map((opt) => (
            <Link
              key={opt.label}
              href={filterUrl({ date: opt.value })}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                (params.date || "") === opt.value
                  ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30"
                  : "bg-zinc-800/50 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              }`}
            >
              {opt.label}
            </Link>
          ))}
          <DateFilterInput currentDate={params.date || ""} status={activeStatus} sport={params.sport || ""} />
        </div>

        {/* Status row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-zinc-600 uppercase tracking-wider font-semibold w-12">Status</span>
          {[
            { label: "All", value: "ALL", dot: "" },
            { label: "Confirmed", value: "CONFIRMED", dot: "bg-emerald-400" },
            { label: "Pending", value: "PENDING", dot: "bg-yellow-400" },
            { label: "Cancelled", value: "CANCELLED", dot: "bg-red-400" },
          ].map((opt) => (
            <Link
              key={opt.label}
              href={filterUrl({ status: opt.value })}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                activeStatus === opt.value
                  ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30"
                  : "bg-zinc-800/50 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              }`}
            >
              {opt.dot && <span className={`h-1.5 w-1.5 rounded-full ${opt.dot}`} />}
              {opt.label}
            </Link>
          ))}
        </div>

        {/* Sport row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-zinc-600 uppercase tracking-wider font-semibold w-12">Sport</span>
          <Link
            href={filterUrl({ sport: "" })}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
              !params.sport
                ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30"
                : "bg-zinc-800/50 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            }`}
          >
            All
          </Link>
          {sports.map((sport) => {
            const emoji = { CRICKET: "🏏", FOOTBALL: "⚽", PICKLEBALL: "🏓", BADMINTON: "🏸" }[sport] || "";
            return (
              <Link
                key={sport}
                href={filterUrl({ sport })}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  params.sport === sport
                    ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30"
                    : "bg-zinc-800/50 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                }`}
              >
                <span>{emoji}</span>
                {SPORT_INFO[sport as Sport]?.name || sport}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Bookings List */}
      {bookings.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-16 text-center">
          <div className="mx-auto h-14 w-14 rounded-full bg-zinc-800 flex items-center justify-center mb-4">
            <Search className="h-6 w-6 text-zinc-600" />
          </div>
          <p className="text-zinc-400 font-medium">No bookings found</p>
          <p className="text-sm text-zinc-600 mt-1">Try adjusting your filters</p>
        </div>
      ) : (
        <BookingsTable
          bookings={bookings.map((b) => ({
            id: b.id,
            date: b.date instanceof Date ? b.date.toISOString() : b.date,
            status: b.status as "CONFIRMED" | "PENDING" | "CANCELLED",
            totalAmount: b.totalAmount,
            createdAt: b.createdAt instanceof Date ? b.createdAt.toISOString() : b.createdAt,
            createdByAdminId: b.createdByAdminId,
            recurringBookingId: b.recurringBookingId,
            user: b.user,
            courtConfig: {
              sport: b.courtConfig.sport,
              label: b.courtConfig.label,
              size: b.courtConfig.size,
            },
            slots: b.slots.map((s) => ({ startHour: s.startHour, price: s.price })),
            payment: b.payment ? { status: b.payment.status, method: b.payment.method, amount: b.payment.amount } : null,
            _isRecurringChildPayment: b._isRecurringChildPayment,
            recurringBooking: b.recurringBooking ? {
              id: b.recurringBooking.id,
              mode: b.recurringBooking.mode ?? "weekly",
              status: b.recurringBooking.status,
              dayOfWeek: b.recurringBooking.dayOfWeek ?? 0,
              startHour: b.recurringBooking.startHour ?? 0,
              endHour: b.recurringBooking.endHour ?? 0,
            } : null,
          }))}
          sportInfo={sportInfoMap}
        />
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-zinc-600">
            Page {page} of {totalPages}
          </p>
          <div className="flex items-center gap-1.5">
            {page > 1 && (
              <Link
                href={filterUrl({ page: (page - 1).toString() })}
                className="rounded-lg px-3 py-1.5 text-xs font-medium bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white transition-colors"
              >
                ← Prev
              </Link>
            )}
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
              .map((p, idx, arr) => {
                const prev = arr[idx - 1];
                const showEllipsis = prev && p - prev > 1;
                return (
                  <span key={p} className="contents">
                    {showEllipsis && <span className="px-1 text-zinc-700">···</span>}
                    <Link
                      href={filterUrl({ page: p.toString() })}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                        p === page
                          ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30"
                          : "bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-white"
                      }`}
                    >
                      {p}
                    </Link>
                  </span>
                );
              })}
            {page < totalPages && (
              <Link
                href={filterUrl({ page: (page + 1).toString() })}
                className="rounded-lg px-3 py-1.5 text-xs font-medium bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white transition-colors"
              >
                Next →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
