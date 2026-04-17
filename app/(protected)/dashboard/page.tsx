import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { SPORT_INFO, formatHoursAsRanges } from "@/lib/court-config";
import { formatPrice, formatBookingDate } from "@/lib/pricing";
import Link from "next/link";
import {
  Calendar,
  Clock,
  ArrowRight,
  History,
  Plus,
  RefreshCw,
  Zap,
  ChevronRight,
} from "lucide-react";
import { SignOutButton } from "@/components/sign-out-button";
import {
  MdSportsCricket,
  MdSportsSoccer,
  MdSportsTennis,
  MdSportsHandball,
} from "react-icons/md";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function getNextBookingCountdown(date: Date, startHour: number): string {
  const now = new Date();
  const bookingTime = new Date(date);
  bookingTime.setHours(startHour, 0, 0, 0);
  const diffMs = bookingTime.getTime() - now.getTime();
  if (diffMs < 0) return "Now";
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays > 0) return `in ${diffDays}d ${diffHours % 24}h`;
  if (diffHours > 0) return `in ${diffHours}h`;
  const diffMins = Math.floor(diffMs / (1000 * 60));
  return `in ${diffMins}m`;
}

const SPORT_ICON_MAP: Record<string, React.ReactNode> = {
  CRICKET: <MdSportsCricket className="h-5 w-5" />,
  FOOTBALL: <MdSportsSoccer className="h-5 w-5" />,
  PICKLEBALL: <MdSportsTennis className="h-5 w-5" />,
  BADMINTON: <MdSportsHandball className="h-5 w-5" />,
};

const SPORT_COLORS: Record<string, { bg: string; border: string; text: string; glow: string }> = {
  CRICKET: {
    bg: "from-emerald-500/20 to-emerald-600/5",
    border: "border-emerald-500/30 hover:border-emerald-400/50",
    text: "text-emerald-400",
    glow: "shadow-emerald-500/10",
  },
  FOOTBALL: {
    bg: "from-blue-500/20 to-blue-600/5",
    border: "border-blue-500/30 hover:border-blue-400/50",
    text: "text-blue-400",
    glow: "shadow-blue-500/10",
  },
  PICKLEBALL: {
    bg: "from-yellow-500/20 to-yellow-600/5",
    border: "border-yellow-500/30 hover:border-yellow-400/50",
    text: "text-yellow-400",
    glow: "shadow-yellow-500/10",
  },
  BADMINTON: {
    bg: "from-purple-500/20 to-purple-600/5",
    border: "border-purple-500/30 hover:border-purple-400/50",
    text: "text-purple-400",
    glow: "shadow-purple-500/10",
  },
};

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [upcomingBookings, totalBookings, thisMonthBookings] = await Promise.all([
    db.booking.findMany({
      where: {
        userId: session.user.id,
        status: "CONFIRMED",
        date: { gte: today },
      },
      include: {
        courtConfig: true,
        slots: { orderBy: { startHour: "asc" } },
      },
      orderBy: { date: "asc" },
      take: 5,
    }),
    db.booking.count({
      where: { userId: session.user.id, status: "CONFIRMED" },
    }),
    db.booking.count({
      where: {
        userId: session.user.id,
        status: "CONFIRMED",
        date: {
          gte: new Date(today.getFullYear(), today.getMonth(), 1),
        },
      },
    }),
  ]);

  const nextBooking = upcomingBookings[0];
  const firstName = session.user.name?.split(" ")[0] || "Player";

  return (
    <div className="space-y-6 pb-8">
      {/* Hero Header */}
      <div className="relative overflow-hidden rounded-2xl border border-zinc-800/50 bg-gradient-to-br from-zinc-900 via-zinc-900 to-emerald-950/30 p-6 sm:p-8">
        <div className="absolute top-0 right-0 h-64 w-64 -translate-y-1/3 translate-x-1/3 rounded-full bg-emerald-500/5 blur-3xl" />
        <div className="absolute bottom-0 left-0 h-40 w-40 translate-y-1/2 -translate-x-1/4 rounded-full bg-emerald-500/5 blur-2xl" />

        <div className="relative">
          <p className="text-sm text-emerald-400/80 font-medium">
            {getGreeting()},
          </p>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold text-white">
            {firstName} 👋
          </h1>

          {nextBooking ? (
            <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-2">
              <Zap className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-sm text-emerald-300">
                Next session{" "}
                <span className="font-semibold">
                  {getNextBookingCountdown(
                    nextBooking.date,
                    nextBooking.slots[0]?.startHour ?? 0
                  )}
                </span>{" "}
                — {SPORT_INFO[nextBooking.courtConfig.sport].name}
              </span>
            </div>
          ) : (
            <p className="mt-3 text-sm text-zinc-500">
              No upcoming sessions. Time to book one!
            </p>
          )}
        </div>
      </div>

      {/* Quick Book CTA */}
      <Link
        href="/book"
        className="group relative flex items-center justify-between overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-r from-emerald-600/15 via-emerald-500/10 to-transparent p-5 transition-all hover:border-emerald-400/40 hover:shadow-lg hover:shadow-emerald-500/5"
      >
        <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/5 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
        <div className="relative flex items-center gap-4">
          <div className="rounded-xl bg-emerald-500/20 p-3 ring-1 ring-emerald-500/20">
            <Plus className="h-6 w-6 text-emerald-400" />
          </div>
          <div>
            <p className="text-lg font-semibold text-white">Book a Court</p>
            <p className="text-sm text-zinc-400">
              Cricket, Football, Pickleball, Badminton
            </p>
          </div>
        </div>
        <ArrowRight className="relative h-5 w-5 text-zinc-600 transition-all group-hover:translate-x-1 group-hover:text-emerald-400" />
      </Link>

      {/* Stats Row */}
      <div className="grid gap-2 sm:gap-3 grid-cols-3">
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/80 px-3 py-3 sm:p-4 backdrop-blur-sm overflow-hidden">
          <p className="text-[10px] sm:text-xs font-medium uppercase text-zinc-500 truncate">
            Upcoming
          </p>
          <p className="mt-1.5 text-2xl sm:text-3xl font-bold text-white">
            {upcomingBookings.length}
          </p>
          <p className="mt-0.5 text-[10px] sm:text-xs text-zinc-600">sessions</p>
        </div>

        <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/80 px-3 py-3 sm:p-4 backdrop-blur-sm overflow-hidden">
          <p className="text-[10px] sm:text-xs font-medium uppercase text-zinc-500 truncate">
            This Month
          </p>
          <p className="mt-1.5 text-2xl sm:text-3xl font-bold text-white">
            {thisMonthBookings}
          </p>
          <p className="mt-0.5 text-[10px] sm:text-xs text-zinc-600">bookings</p>
        </div>

        <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/80 px-3 py-3 sm:p-4 backdrop-blur-sm overflow-hidden">
          <p className="text-[10px] sm:text-xs font-medium uppercase text-zinc-500 truncate">
            All Time
          </p>
          <p className="mt-1.5 text-2xl sm:text-3xl font-bold text-white">{totalBookings}</p>
          <p className="mt-0.5 text-[10px] sm:text-xs text-zinc-600">total</p>
        </div>
      </div>

      {/* Quick Links */}
      <div className="grid gap-3 grid-cols-2">
        <Link
          href="/bookings"
          className="group flex items-center gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-4 transition-all hover:border-zinc-700"
        >
          <div className="rounded-lg bg-zinc-800 p-2">
            <History className="h-4 w-4 text-zinc-500" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-white">Booking History</p>
            <p className="text-xs text-zinc-600">View past sessions</p>
          </div>
          <ArrowRight className="h-4 w-4 text-zinc-700 transition-all group-hover:text-zinc-400 group-hover:translate-x-0.5" />
        </Link>

        <Link
          href="/bookings?filter=recurring"
          className="group flex items-center gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-4 transition-all hover:border-zinc-700"
        >
          <div className="rounded-lg bg-zinc-800 p-2">
            <RefreshCw className="h-4 w-4 text-zinc-500" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-white">Recurring</p>
            <p className="text-xs text-zinc-600">Weekly bookings</p>
          </div>
          <ArrowRight className="h-4 w-4 text-zinc-700 transition-all group-hover:text-zinc-400 group-hover:translate-x-0.5" />
        </Link>
      </div>

      {/* Upcoming Bookings */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wider">
            Upcoming Sessions
          </h2>
          {upcomingBookings.length > 0 && (
            <Link
              href="/bookings"
              className="text-xs text-emerald-500 hover:text-emerald-400 transition-colors flex items-center gap-1"
            >
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </div>

        {upcomingBookings.length > 0 ? (
          <div className="space-y-2">
            {upcomingBookings.map((booking, index) => {
              const sport = booking.courtConfig.sport;
              const sportInfo = SPORT_INFO[sport];
              const colors = SPORT_COLORS[sport];
              const isNext = index === 0;

              return (
                <Link
                  key={booking.id}
                  href={`/book/confirmation?id=${booking.id}`}
                  className={`group block rounded-xl border p-4 transition-all ${
                    isNext
                      ? `${colors.border} bg-gradient-to-r ${colors.bg} hover:shadow-lg ${colors.glow}`
                      : "border-zinc-800/80 bg-zinc-900/60 hover:border-zinc-700"
                  }`}
                >
                  {/* Top row: icon + sport name + badge + price */}
                  <div className="flex items-center gap-3">
                    <div
                      className={`shrink-0 rounded-lg p-2 ${
                        isNext
                          ? "bg-white/5 ring-1 ring-white/10"
                          : "bg-zinc-800"
                      }`}
                    >
                      <span className={colors.text}>
                        {SPORT_ICON_MAP[sport]}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-white truncate">
                          {sportInfo.name}
                        </p>
                        {isNext && (
                          <span className="shrink-0 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                            Next
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500 truncate">
                        {booking.courtConfig.label}
                      </p>
                    </div>
                    <div className="shrink-0 flex items-center gap-1">
                      <span className={`text-sm font-bold ${colors.text}`}>
                        {formatPrice(booking.totalAmount)}
                      </span>
                      <ChevronRight className="h-4 w-4 text-zinc-700 group-hover:text-zinc-400 group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </div>

                  {/* Bottom row: date + time */}
                  <div className="mt-2 ml-[44px] flex items-center gap-4 text-xs text-zinc-400">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3 shrink-0" />
                      {formatBookingDate(booking.date, {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3 shrink-0" />
                      {formatHoursAsRanges(booking.slots.map((s) => s.startHour))}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          /* Empty State */
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/30 py-12 px-6 text-center">
            <div className="rounded-full bg-zinc-800/80 p-4 mb-4">
              <Calendar className="h-8 w-8 text-zinc-600" />
            </div>
            <p className="text-base font-medium text-zinc-400">
              No upcoming sessions
            </p>
            <p className="mt-1 text-sm text-zinc-600">
              Book your first court and get playing!
            </p>
            <Link
              href="/book"
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition-all hover:bg-emerald-500 hover:shadow-lg hover:shadow-emerald-500/20"
            >
              <Plus className="h-4 w-4" />
              Book Now
            </Link>
          </div>
        )}
      </div>

      {/* Sign Out */}
      <SignOutButton
        className="w-full flex items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-500 hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/5 transition-all"
      />
    </div>
  );
}
