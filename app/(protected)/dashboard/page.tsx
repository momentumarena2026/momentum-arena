import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { SPORT_INFO, formatHour } from "@/lib/court-config";
import { formatPrice, formatBookingDate } from "@/lib/pricing";
import Link from "next/link";
import {
  Calendar,
  Clock,
  ArrowRight,
  Ticket,
  History,
  Plus,
  Bell,
  RefreshCw,
} from "lucide-react";
import {
  MdSportsCricket,
  MdSportsSoccer,
  MdSportsTennis,
  MdSportsHandball,
} from "react-icons/md";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [upcomingBookings, totalBookings, waitlistCount] = await Promise.all([
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
      take: 3,
    }),
    db.booking.count({
      where: { userId: session.user.id },
    }),
    db.waitlist.count({
      where: { userId: session.user.id, status: { in: ["WAITING", "NOTIFIED"] } },
    }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white">Dashboard</h1>
        <p className="text-zinc-400 mt-1">
          Welcome back, {session?.user?.name || "Player"}!
        </p>
      </div>

      {/* Quick Action */}
      <Link
        href="/book"
        className="group flex items-center justify-between rounded-2xl border border-emerald-500/20 bg-gradient-to-r from-emerald-500/10 to-transparent p-5 transition-all hover:border-emerald-500/40"
      >
        <div className="flex items-center gap-4">
          <div className="rounded-xl bg-emerald-500/20 p-3">
            <Plus className="h-6 w-6 text-emerald-400" />
          </div>
          <div>
            <p className="text-lg font-semibold text-white">Book a Court</p>
            <p className="text-sm text-zinc-400">
              Cricket, Football, Pickleball, Badminton
            </p>
          </div>
        </div>
        <ArrowRight className="h-5 w-5 text-zinc-600 transition-transform group-hover:translate-x-1 group-hover:text-emerald-400" />
      </Link>

      {/* Stats Row */}
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-center gap-2 text-zinc-500">
            <Ticket className="h-4 w-4" />
            <span className="text-xs">Upcoming</span>
          </div>
          <p className="mt-2 text-2xl font-bold text-white">
            {upcomingBookings.length}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-center gap-2 text-zinc-500">
            <History className="h-4 w-4" />
            <span className="text-xs">Total Bookings</span>
          </div>
          <p className="mt-2 text-2xl font-bold text-white">{totalBookings}</p>
        </div>
        <Link
          href="/bookings"
          className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 hover:border-zinc-700 transition-colors col-span-2 sm:col-span-1"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-zinc-500">View All</p>
              <p className="mt-2 text-sm font-medium text-emerald-400">
                My Bookings →
              </p>
            </div>
            <Calendar className="h-8 w-8 text-zinc-700" />
          </div>
        </Link>
      </div>

      {/* Waitlist + Recurring Row */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
        {/* Waitlist Card */}
        <Link
          href="/waitlist"
          className="group rounded-xl border border-zinc-800 bg-zinc-900 p-4 hover:border-yellow-500/30 transition-colors"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-zinc-500">
              <Bell className="h-4 w-4" />
              <span className="text-xs">Waitlist</span>
            </div>
            {waitlistCount > 0 && (
              <span className="rounded-full bg-yellow-500/20 border border-yellow-500/30 px-2 py-0.5 text-xs font-medium text-yellow-400">
                {waitlistCount}
              </span>
            )}
          </div>
          <p className="mt-2 text-xl font-bold text-white">
            {waitlistCount > 0 ? `${waitlistCount} active` : "None"}
          </p>
          <p className="text-xs text-zinc-500 mt-0.5">Notify me when slots open</p>
        </Link>

        {/* Recurring Bookings Card */}
        <Link
          href="/bookings"
          className="group rounded-xl border border-zinc-800 bg-zinc-900 p-4 hover:border-zinc-700 transition-colors"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-zinc-500">
              <RefreshCw className="h-4 w-4" />
              <span className="text-xs">Recurring</span>
            </div>
            <ArrowRight className="h-4 w-4 text-zinc-700 group-hover:text-zinc-400 transition-colors" />
          </div>
          <p className="mt-2 text-xl font-bold text-white">Series</p>
          <p className="text-xs text-zinc-500 mt-0.5">Manage weekly bookings</p>
        </Link>
      </div>

      {/* Upcoming Bookings */}
      {upcomingBookings.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium text-zinc-500 uppercase tracking-wider">
            Upcoming Bookings
          </h2>
          <div className="space-y-3">
            {upcomingBookings.map((booking) => {
              const sportInfo = SPORT_INFO[booking.courtConfig.sport];

              return (
                <Link
                  key={booking.id}
                  href={`/book/confirmation/${booking.id}`}
                  className="group flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 p-4 transition-all hover:border-zinc-700"
                >
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-zinc-800 p-2">
                      {booking.courtConfig.sport === "CRICKET" && (
                        <MdSportsCricket className="h-5 w-5 text-emerald-400" />
                      )}
                      {booking.courtConfig.sport === "FOOTBALL" && (
                        <MdSportsSoccer className="h-5 w-5 text-blue-400" />
                      )}
                      {booking.courtConfig.sport === "PICKLEBALL" && (
                        <MdSportsTennis className="h-5 w-5 text-yellow-400" />
                      )}
                      {booking.courtConfig.sport === "BADMINTON" && (
                        <MdSportsHandball className="h-5 w-5 text-purple-400" />
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-white">
                        {sportInfo.name} — {booking.courtConfig.label}
                      </p>
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
                  <span className="text-sm font-semibold text-emerald-400">
                    {formatPrice(booking.totalAmount)}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
