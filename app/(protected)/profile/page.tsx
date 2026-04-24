import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getProfile } from "@/actions/profile";
import Link from "next/link";
import {
  Phone,
  User as UserIcon,
  Shield,
  Calendar,
  Clock,
  ArrowRight,
  History,
  RefreshCw,
  ChevronRight,
  Plus,
} from "lucide-react";
import {
  MdSportsCricket,
  MdSportsSoccer,
  MdSportsTennis,
} from "react-icons/md";
import { SignOutButton } from "@/components/sign-out-button";
import {
  SPORT_INFO,
  formatHoursAsRanges,
  customerFacingCourtLabel,
} from "@/lib/court-config";
import { formatPrice, formatBookingDate } from "@/lib/pricing";

const SPORT_ICON_MAP: Record<string, React.ReactNode> = {
  CRICKET: <MdSportsCricket className="h-5 w-5" />,
  FOOTBALL: <MdSportsSoccer className="h-5 w-5" />,
  PICKLEBALL: <MdSportsTennis className="h-5 w-5" />,
};

const SPORT_COLORS: Record<
  string,
  { bg: string; border: string; text: string; glow: string }
> = {
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
};

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const profile = await getProfile();
  if (!profile) redirect("/login");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const upcomingBookings = await db.booking.findMany({
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
  });

  return (
    <div className="mx-auto max-w-xl space-y-6 pb-8">
      {/* Title block — mirrors mobile's "My Profile" header */}
      <div>
        <h1 className="text-2xl font-bold text-white">My Profile</h1>
        <p className="mt-1 text-zinc-400">Manage your account information</p>
      </div>

      {/* Profile Header — avatar + name + USER role pill (no email, no bookings pill) */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-2xl font-bold text-emerald-400">
            {profile.name?.charAt(0)?.toUpperCase() || "?"}
          </div>
          <div>
            <h2 className="text-xl font-semibold text-white">
              {profile.name || "Player"}
            </h2>
            <div className="mt-1 flex items-center gap-3 text-sm">
              <span
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                  profile.role === "ADMIN"
                    ? "border-red-500/30 bg-red-500/10 text-red-400"
                    : "border-blue-500/30 bg-blue-500/10 text-blue-400"
                }`}
              >
                <Shield className="h-3 w-3" />
                {profile.role}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Account Info — Name + Phone only (no email, no member since) */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-3">
        <h3 className="text-sm font-medium text-zinc-500 uppercase tracking-wider">
          Account Info
        </h3>
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-zinc-400">
              <UserIcon className="h-4 w-4" />
              Name
            </span>
            <span className="text-white">{profile.name || "Not set"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-zinc-400">
              <Phone className="h-4 w-4" />
              Phone
            </span>
            <span className="text-white">{profile.phone || "Not set"}</span>
          </div>
        </div>
      </div>

      {/* Full-width stacked action tiles */}
      <div className="space-y-3">
        <Link
          href="/bookings"
          className="group flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4 transition-all hover:border-zinc-700"
        >
          <div className="rounded-lg bg-zinc-800 p-2">
            <History className="h-4 w-4 text-zinc-400" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-white">Booking History</p>
            <p className="text-xs text-zinc-500">View past sessions</p>
          </div>
          <ChevronRight className="h-4 w-4 text-zinc-600 transition-all group-hover:text-zinc-400 group-hover:translate-x-0.5" />
        </Link>

        <Link
          href="/bookings?filter=recurring"
          className="group flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4 transition-all hover:border-zinc-700"
        >
          <div className="rounded-lg bg-zinc-800 p-2">
            <RefreshCw className="h-4 w-4 text-zinc-400" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-white">Recurring Bookings</p>
            <p className="text-xs text-zinc-500">Weekly series</p>
          </div>
          <ChevronRight className="h-4 w-4 text-zinc-600 transition-all group-hover:text-zinc-400 group-hover:translate-x-0.5" />
        </Link>
      </div>

      {/* Upcoming Sessions */}
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
                  {/* Top row: icon + sport name + NEXT pill + price */}
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
                        {customerFacingCourtLabel(
                          booking.courtConfig.label,
                          booking.wasBookedAsHalfCourt
                        )}
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
                      {formatHoursAsRanges(
                        booking.slots.map((s) => s.startHour)
                      )}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          /* Empty State — dashed border w/ Calendar circle + Book Now */
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
      <SignOutButton className="w-full flex items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-500 hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/5 transition-all" />

      {/* Version footer */}
      <p className="pt-2 text-center text-xs text-zinc-600">
        Momentum Arena · v0.1.0
      </p>
    </div>
  );
}
