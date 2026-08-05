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
  Banknote,
  CalendarDays,
  List,
} from "lucide-react";
import { BookingsTable } from "./bookings-table";
import { FiltersCollapsible } from "./filters-collapsible";
import { FiltersPersist } from "./filters-persist";
import { UserSearchInput } from "./user-search-input";

export default async function AdminBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    status?: string;
    sport?: string;
    date?: string;
    platform?: string;
    payment?: string;
    /** Free-text user search (name / phone / email substring). Wired
     *  through getAdminBookings to a Prisma OR clause on user. */
    q?: string;
    /** Result ordering: "createdAt" (default — when the booking was
     *  placed) or "date" (the actual session date). */
    sort?: string;
  }>;
}) {
  const params = await searchParams;
  const page = parseInt(params.page || "1");
  const today = getTodayIST();

  // Multi-select filters arrive as CSV in the URL — parse to string[]
  // here so the chip rendering can drive the "active" state by
  // includes() and the toggle URL builder can compose/decompose the
  // list cleanly. Empty (or absent) values mean "no filter / All";
  // status alone has a non-empty default so the typical front-desk
  // view (active + no-show bookings) renders without explicit chips.
  function parseCsv(raw: string | undefined): string[] {
    if (raw === undefined) return [];
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && s !== "ALL");
  }
  const statusList: string[] =
    params.status === undefined
      ? ["CONFIRMED", "ABSENT"] // default mirrors the front-desk's working view
      : parseCsv(params.status);
  const sportList = parseCsv(params.sport);
  const platformList = parseCsv(params.platform);
  const paymentList = parseCsv(params.payment);

  const activeSort: "createdAt" | "date" =
    params.sort === "date" ? "date" : "createdAt";

  const [{ bookings, total, totalPages }, stats] = await Promise.all([
    getAdminBookings({
      page,
      status: statusList,
      sport: sportList,
      date: params.date,
      platform: platformList,
      payment: paymentList,
      q: params.q,
      sort: activeSort,
      limit: 20,
    }),
    getAdminStats(),
  ]);

  const sports = ["CRICKET", "FOOTBALL", "PICKLEBALL"];

  const sportInfoMap: Record<string, { name: string; icon: string }> = {};
  for (const key of sports) {
    const info = SPORT_INFO[key as Sport];
    if (info) sportInfoMap[key] = { name: info.name, icon: "" };
  }

  function filterUrl(overrides: Record<string, string>) {
    const base: Record<string, string> = {
      // Serialise the active multi-select lists back to CSV. Empty
      // list = no param (= "All" semantics). "ALL" sentinel
      // explicitly disables the default for status when the user
      // clicks All.
      status: statusList.length > 0 ? statusList.join(",") : "ALL",
      sport: sportList.join(","),
      date: params.date || "",
      platform: platformList.join(","),
      payment: paymentList.join(","),
      q: params.q || "",
      // Preserve sort across filter clicks; default ("createdAt")
      // is dropped from the URL via the filter below so we don't
      // pollute with `?sort=createdAt`.
      sort: activeSort === "date" ? "date" : "",
      page: "1",
    };
    const merged = { ...base, ...overrides };
    const qs = Object.entries(merged)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");
    return `/admin/bookings${qs ? `?${qs}` : ""}`;
  }

  // Toggle `value` in/out of a CSV filter, returning the URL the
  // chip should link to. Special case: clicking "ALL" clears the
  // entire list (also drops the default for status by setting the
  // sentinel `ALL` in the URL).
  function toggleMultiUrl(
    key: "status" | "sport" | "platform" | "payment",
    value: string,
    currentList: string[],
  ): string {
    if (value === "ALL") {
      return filterUrl({ [key]: "ALL" });
    }
    const next = currentList.includes(value)
      ? currentList.filter((v) => v !== value)
      : [...currentList, value];
    return filterUrl({ [key]: next.length > 0 ? next.join(",") : "ALL" });
  }

  // Business aggregates are superadmin-only — getAdminStats nulls them for
  // staff admins (server-side), so the tiles simply don't exist for them.
  // Today's Bookings and Cash Due at Venue stay: they're the front desk's
  // working numbers, not business totals.
  const statCards = [
    ...(stats.totalBookings !== null
      ? [
          {
            label: "Total Bookings",
            value: stats.totalBookings.toLocaleString(),
            icon: TrendingUp,
            color: "text-emerald-400",
            bg: "bg-emerald-500/10",
            border: "border-emerald-500/20",
          },
        ]
      : []),
    {
      label: "Today's Bookings",
      value: stats.todayBookings.toString(),
      icon: CalendarCheck,
      color: "text-blue-400",
      bg: "bg-blue-500/10",
      border: "border-blue-500/20",
    },
    ...(stats.todayEarning !== null
      ? [
          {
            // "Today's Earning" = actual cash flow today (advances + full
            // payments confirmed today, plus remainders collected today on
            // earlier-confirmed bookings). Replaces the older "Today's
            // Revenue" tile that summed Booking.totalAmount on confirmedAt
            // today — that under-counted PARTIAL bookings whose remainder
            // arrived later, and ignored late-arriving venue cash on older
            // partials entirely.
            label: "Today's Earning",
            value: formatPrice(stats.todayEarning),
            icon: IndianRupee,
            color: "text-yellow-400",
            bg: "bg-yellow-500/10",
            border: "border-yellow-500/20",
          },
        ]
      : []),
    ...(stats.totalRevenue !== null
      ? [
          {
            label: "Total Sports Earnings",
            value: formatPrice(stats.totalRevenue),
            icon: IndianRupee,
            color: "text-emerald-300",
            bg: "bg-emerald-500/10",
            border: "border-emerald-500/20",
          },
        ]
      : []),
    {
      label: "Cash Due at Venue",
      value: formatPrice(stats.venueDueTotal),
      icon: Banknote,
      color: "text-amber-300",
      bg: "bg-amber-500/10",
      border: "border-amber-500/20",
    },
  ];

  // "Has the user touched any filter relative to defaults?" — drives
  // the FiltersCollapsible auto-expand. Status is the only filter
  // with a non-empty default ({CONFIRMED, ABSENT}); we treat the
  // status filter as "touched" only when its URL representation is
  // present (the absence of `?status` means defaults are active).
  const activeFilters = [
    params.status,
    sportList.length > 0,
    params.date,
    platformList.length > 0,
    paymentList.length > 0,
    params.q,
  ].filter(Boolean).length;

  return (
    // `pb-32 md:pb-0` reserves enough space below the last row on
    // mobile so the sticky "Filters" bar can never overlap the
    // pagination controls. The bar itself is ~56px tall but iOS
    // safe-area can add 20-30px on top of that, plus we want a
    // visible gap above the pagination so it's tappable — 8rem
    // (128px) covers all three. Desktop has no bar so no padding.
    <div className="space-y-6 pb-32 md:pb-0">
      {/* Cross-session filter persistence. Snapshots URL filter params
          to localStorage on mount, and on a fresh visit (no params)
          replaces the URL with the saved snapshot so staff don't have
          to re-pick "Confirmed + Today + Cricket" every time they
          come back. See filters-persist.tsx for the full design. */}
      <FiltersPersist />

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Bookings</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {total} {params.status || params.sport || params.date ? "filtered" : "total"} bookings
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/bookings/create"
            // Label hidden on small screens — narrow viewports get the
            // icon-only pill so the toggler to the right still fits.
            className="flex items-center gap-2 rounded-xl bg-emerald-600 px-3 sm:px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 transition-colors shadow-lg shadow-emerald-900/20"
            aria-label="New Booking"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New Booking</span>
          </Link>

          {/* View toggle (Table / Calendar) — twin of the toggle on
              /admin/bookings/calendar so admins can flip between
              the two views from either landing point. Table is the
              active state here; Calendar links over. On mobile the
              labels collapse to icons so the header stays compact. */}
          <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-md bg-emerald-500/20 px-2 sm:px-3 py-1.5 text-xs font-medium text-emerald-400"
              aria-label="Table view"
              aria-current="page"
            >
              <List className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Table</span>
            </button>
            <Link
              href="/admin/bookings/calendar"
              className="flex items-center gap-1.5 rounded-md px-2 sm:px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-300"
              aria-label="Calendar view"
            >
              <CalendarDays className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Calendar</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
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

      {/* Filters — collapsed by default so the booking list isn't
          shoved off-screen by 5 stacked chip rows. Auto-expands when
          the URL already has any non-default filter applied. */}
      <FiltersCollapsible
        activeFilters={activeFilters}
        totalLabel={`${total} ${total === 1 ? "booking" : "bookings"}`}
        defaultExpanded={activeFilters > 0}
      >
        {/* User search — typed input, all other filters here are
            link-driven chips. The component preserves the rest of
            the URL params when the search submits so chips + search
            compose freely. */}
        <UserSearchInput
          initialValue={params.q || ""}
          preservedParams={[
            // Serialise the multi-select lists back to CSV so the
            // search submit preserves them. Empty lists drop the
            // param (= default semantics).
            ["status", statusList.length > 0 ? statusList.join(",") : ""],
            ["sport", sportList.join(",")],
            ["date", params.date ?? ""],
            ["platform", platformList.join(",")],
            ["payment", paymentList.join(",")],
          ]
            .filter(([, v]) => v)
            .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
            .join("&")}
        />

        {/* The 5 chip-based filter rows flow into a 2-column grid on
            md+ viewports so the card uses the full card width instead
            of leaving 50 % blank on the right. Mobile (<md) stays as
            a vertical stack via `space-y-3`. `md:space-y-0` undoes the
            mobile stack-gap on desktop where the grid's gap-y takes
            over. Order is left-to-right top-to-bottom:
              Row 1: Date     | Status
              Row 2: Sport    | Platform
              Row 3: Payment  (md:col-span-2 — fills the trailing
                                empty cell so the card looks balanced) */}
        <div className="space-y-3 md:grid md:grid-cols-2 md:gap-x-6 md:gap-y-3 md:space-y-0">
        {/* Date row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="shrink-0 w-20 text-[10px] text-zinc-600 uppercase tracking-wider font-semibold">Date</span>
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
          <DateFilterInput
            currentDate={params.date || ""}
            // DateFilterInput composes one URL preserve-string. We
            // pass the canonical first selected value so its
            // existing single-value props stay typed; the bulk
            // preservation happens via the search query string
            // above for the multi-select cases.
            status={statusList[0] ?? ""}
            sport={sportList[0] ?? ""}
          />
        </div>

        {/* Status row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="shrink-0 w-20 text-[10px] text-zinc-600 uppercase tracking-wider font-semibold">Status</span>
          {/* Multi-select chips — "All" is exclusive (clears the
              specific picks); the rest toggle in/out of statusList.
              Defaults to Confirmed + Absent (the front desk's daily
              working view). Completed is off the default but needs a
              chip of its own: closing a session out is the terminal
              state for most bookings, and without a chip those rows
              were only reachable by clearing every filter. */}
          {[
            { label: "All", value: "ALL", dot: "" },
            { label: "Confirmed", value: "CONFIRMED", dot: "bg-emerald-400" },
            { label: "Pending", value: "PENDING", dot: "bg-yellow-400" },
            { label: "Completed", value: "COMPLETED", dot: "bg-sky-400" },
            { label: "Cancelled", value: "CANCELLED", dot: "bg-red-400" },
            { label: "Absent", value: "ABSENT", dot: "bg-amber-300" },
          ].map((opt) => {
            const isActive =
              opt.value === "ALL"
                ? statusList.length === 0
                : statusList.includes(opt.value);
            return (
              <Link
                key={opt.label}
                href={toggleMultiUrl("status", opt.value, statusList)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  isActive
                    ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30"
                    : "bg-zinc-800/50 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                }`}
              >
                {opt.dot && (
                  <span className={`h-1.5 w-1.5 rounded-full ${opt.dot}`} />
                )}
                {opt.label}
              </Link>
            );
          })}
        </div>

        {/* Sort row — choose between order-of-booking (createdAt
            desc, the default front-desk view) and order-of-actual-
            session (booking date desc, useful when the operator is
            chasing today/tomorrow's confirmations). The two chips
            mirror the Status row's chip style for visual
            consistency. */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="shrink-0 w-20 text-[10px] text-zinc-600 uppercase tracking-wider font-semibold">Sort by</span>
          {[
            { label: "Booked at", value: "createdAt" },
            { label: "Booking date", value: "date" },
          ].map((opt) => (
            <Link
              key={opt.value}
              href={filterUrl({ sort: opt.value === "createdAt" ? "" : "date" })}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                activeSort === opt.value
                  ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30"
                  : "bg-zinc-800/50 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              }`}
            >
              {opt.label}
            </Link>
          ))}
        </div>

        {/* Sport row — multi-select chips, "All" clears the picks. */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="shrink-0 w-20 text-[10px] text-zinc-600 uppercase tracking-wider font-semibold">Sport</span>
          <Link
            href={toggleMultiUrl("sport", "ALL", sportList)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
              sportList.length === 0
                ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30"
                : "bg-zinc-800/50 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            }`}
          >
            All
          </Link>
          {sports.map((sport) => {
            const emoji = { CRICKET: "🏏", FOOTBALL: "⚽", PICKLEBALL: "🏓" }[sport] || "";
            const isActive = sportList.includes(sport);
            return (
              <Link
                key={sport}
                href={toggleMultiUrl("sport", sport, sportList)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  isActive
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

        {/* Platform row — origin of the booking. "web" includes both
             customer-facing site and admin-created bookings (admin uses
             web). "android" / "ios" come from the React Native app via
             the X-Platform header. */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="shrink-0 w-20 text-[10px] text-zinc-600 uppercase tracking-wider font-semibold">Platform</span>
          {[
            { label: "All", value: "ALL", emoji: "" },
            { label: "Web", value: "web", emoji: "💻" },
            { label: "Android", value: "android", emoji: "🤖" },
            { label: "iOS", value: "ios", emoji: "🍎" },
          ].map((opt) => {
            const isActive =
              opt.value === "ALL"
                ? platformList.length === 0
                : platformList.includes(opt.value);
            return (
              <Link
                key={opt.label}
                href={toggleMultiUrl("platform", opt.value, platformList)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  isActive
                    ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30"
                    : "bg-zinc-800/50 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                }`}
              >
                {opt.emoji && <span>{opt.emoji}</span>}
                {opt.label}
              </Link>
            );
          })}
        </div>

        {/* Payment row — completion-state filter on top of the
             Status filter. "Pending" is a custom predicate
             (CONFIRMED + payment != COMPLETED OR null) so the floor
             staff can quickly find every confirmed booking that
             still has money owed at the venue. Spans both grid
             columns on desktop so the bottom row doesn't leave an
             empty cell. */}
        <div className="flex items-center gap-2 flex-wrap md:col-span-2">
          <span className="shrink-0 w-20 text-[10px] text-zinc-600 uppercase tracking-wider font-semibold">Payment</span>
          {[
            { label: "All", value: "ALL", dot: "" },
            { label: "Completed", value: "completed", dot: "bg-emerald-400" },
            { label: "Pending", value: "pending", dot: "bg-amber-400" },
          ].map((opt) => {
            const isActive =
              opt.value === "ALL"
                ? paymentList.length === 0
                : paymentList.includes(opt.value);
            return (
              <Link
                key={opt.label}
                href={toggleMultiUrl("payment", opt.value, paymentList)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  isActive
                    ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30"
                    : "bg-zinc-800/50 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                }`}
              >
                {opt.dot && (
                  <span className={`h-1.5 w-1.5 rounded-full ${opt.dot}`} />
                )}
                {opt.label}
              </Link>
            );
          })}
        </div>
        </div>
      </FiltersCollapsible>

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
            status: b.status as
              | "CONFIRMED"
              | "PENDING"
              | "CANCELLED"
              | "COMPLETED"
              | "ABSENT",
            totalAmount: b.totalAmount,
            createdAt: b.createdAt instanceof Date ? b.createdAt.toISOString() : b.createdAt,
            createdByAdminId: b.createdByAdminId,
            recurringBookingId: b.recurringBookingId,
            platform: b.platform,
            user: b.user,
            courtConfig: {
              sport: b.courtConfig.sport,
              label: b.courtConfig.label,
              size: b.courtConfig.size,
            },
            slots: b.slots.map((s) => ({
              startHour: s.startHour,
              startMinute: s.startMinute,
              durationMinutes: s.durationMinutes,
              price: s.price,
            })),
            payment: b.payment ? {
              status: b.payment.status,
              method: b.payment.method,
              amount: b.payment.amount,
              isPartialPayment: b.payment.isPartialPayment,
              advanceAmount: b.payment.advanceAmount,
              remainingAmount: b.payment.remainingAmount,
              // Venue legs already taken — the row chip nets these off so
              // a part-paid booking stops advertising the full remainder.
              remainderCashAmount: b.payment.remainderCashAmount,
              remainderUpiAmount: b.payment.remainderUpiAmount,
            } : null,
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
