import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { SPORT_INFO, formatHoursAsRanges, customerFacingCourtLabel } from "@/lib/court-config";
import { formatPrice, formatBookingDate } from "@/lib/pricing";
import Link from "next/link";
import {
  Bell,
  Calendar,
  Clock,
  ArrowRight,
  History,
  MessageCircle,
  Plus,
  ShoppingBag,
  Zap,
  ChevronRight,
  Phone,
  Sparkles,
  Ticket,
  Coffee,
} from "lucide-react";
import { readBalance } from "@/lib/rewards/balance";
import { getRewardConfig } from "@/lib/rewards/config";
import { getMyPasses } from "@/actions/passes";
import { arePassesEnabled } from "@/lib/passes";
import { SignOutButton } from "@/components/sign-out-button";
import { OpenChatButton } from "@/components/chatbot/open-chat-button";
import {
  MdSportsCricket,
  MdSportsSoccer,
  MdSportsTennis,
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
};

/** One tile in the account hub. Per-tile accent keeps the grid scannable
 *  — each destination owns a colour. */
function HubTile({
  href,
  icon,
  iconClass,
  title,
  subtitle,
  featured = false,
}: {
  href: string;
  icon: React.ReactNode;
  iconClass: string;
  title: string;
  subtitle: string;
  featured?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group flex items-center gap-3.5 rounded-2xl border p-4 transition-all ${
        featured
          ? "border-emerald-500/30 bg-gradient-to-r from-emerald-500/10 to-transparent hover:border-emerald-500/50"
          : "border-zinc-800/80 bg-zinc-900/60 hover:-translate-y-0.5 hover:border-zinc-700 hover:bg-zinc-900"
      }`}
    >
      <div className={`rounded-xl p-2.5 ${iconClass}`}>{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="truncate text-xs text-zinc-500">{subtitle}</p>
      </div>
      <ArrowRight
        className={`h-4 w-4 shrink-0 transition-all group-hover:translate-x-0.5 ${
          featured
            ? "text-emerald-500/70 group-hover:text-emerald-400"
            : "text-zinc-700 group-hover:text-zinc-400"
        }`}
      />
    </Link>
  );
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [upcomingBookings, totalBookings, thisMonthBookings, user, rewardBalance, rewardCfg, myPasses, passesEnabled] = await Promise.all([
    db.booking.findMany({
      where: {
        userId: session.user.id,
        status: "CONFIRMED",
        date: { gte: today },
      },
      include: {
        courtConfig: true,
        slots: { orderBy: { startHour: "asc" } },
        // method drives the price label — pass-paid sessions show
        // "Pass" instead of a rupee amount the customer never paid.
        payment: { select: { method: true } },
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
    db.user.findUnique({
      where: { id: session.user.id },
      select: { name: true, phone: true },
    }),
    readBalance(session.user.id),
    getRewardConfig(),
    getMyPasses().catch(() => []),
    arePassesEnabled().catch(() => false),
  ]);

  const nextBooking = upcomingBookings[0];
  const firstName = session.user.name?.split(" ")[0] || "Player";
  const initial = (user?.name?.charAt(0) || firstName.charAt(0) || "?").toUpperCase();
  const livePasses = myPasses.filter(
    (p) => p.status === "ACTIVE" || p.status === "UPCOMING",
  );
  const showPasses = passesEnabled || myPasses.length > 0;

  return (
    <div className="space-y-6 pb-8">
      {/* ── Hero — identity + what's next, in one card ─────────────── */}
      <div className="relative overflow-hidden rounded-3xl border border-zinc-800/50 bg-gradient-to-br from-zinc-900 via-zinc-900 to-emerald-950/40 p-6 sm:p-8">
        <div className="absolute right-0 top-0 h-64 w-64 -translate-y-1/3 translate-x-1/3 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute bottom-0 left-0 h-40 w-40 -translate-x-1/4 translate-y-1/2 rounded-full bg-emerald-500/5 blur-2xl" />

        <div className="relative flex items-start gap-4">
          {/* Avatar */}
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15 text-xl font-bold text-emerald-300 ring-1 ring-emerald-500/30 sm:h-16 sm:w-16 sm:text-2xl">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-emerald-400/80">
              {getGreeting()},
            </p>
            <h1 className="mt-0.5 flex items-baseline gap-2 text-2xl font-bold text-white sm:text-3xl">
              {/* Name truncates; the wave never gets eaten by the ellipsis. */}
              <span className="min-w-0 truncate">{user?.name || firstName}</span>
              <span className="shrink-0">👋</span>
            </h1>
            {user?.phone && (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500">
                <Phone className="h-3 w-3" /> {user.phone}
              </p>
            )}
          </div>
        </div>

        <div className="relative mt-5 flex flex-wrap items-center gap-2">
          {nextBooking ? (
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-2">
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
            </span>
          ) : (
            <span className="text-sm text-zinc-500">
              No upcoming sessions. Time to book one!
            </span>
          )}
          {rewardCfg.enabled && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700/80 bg-zinc-900/80 px-3.5 py-2 text-sm text-zinc-300">
              <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
              {rewardBalance.pointsAvailable.toLocaleString("en-IN")} pts
            </span>
          )}
        </div>
      </div>

      {/* ── Stats row ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {(
          [
            { label: "Upcoming", value: upcomingBookings.length, unit: "sessions" },
            { label: "This Month", value: thisMonthBookings, unit: "bookings" },
            { label: "All Time", value: totalBookings, unit: "total" },
          ] as const
        ).map((s) => (
          <div
            key={s.label}
            className="overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/80 px-3 py-3 backdrop-blur-sm sm:p-4"
          >
            <p className="truncate text-[10px] font-medium uppercase text-zinc-500 sm:text-xs">
              {s.label}
            </p>
            <p className="mt-1.5 text-2xl font-bold text-white sm:text-3xl">
              {s.value}
            </p>
            <p className="mt-0.5 text-[10px] text-zinc-600 sm:text-xs">{s.unit}</p>
          </div>
        ))}
      </div>

      {/* ── Account hub — priority-ordered destinations ────────────── */}
      <div>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-zinc-500">
          My Account
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {rewardCfg.enabled && (
            <HubTile
              href="/rewards"
              icon={<Sparkles className="h-5 w-5 text-emerald-400" />}
              iconClass="bg-emerald-500/15"
              title="My Momentum Points"
              subtitle={`${rewardBalance.pointsAvailable.toLocaleString("en-IN")} pts available`}
              featured
            />
          )}
          <HubTile
            href="/bookings"
            icon={<History className="h-5 w-5 text-blue-400" />}
            iconClass="bg-blue-500/15"
            title="My Bookings"
            subtitle={`${totalBookings} session${totalBookings === 1 ? "" : "s"} · history & recurring`}
          />
          {showPasses && (
            <HubTile
              href="/my-passes"
              icon={<Ticket className="h-5 w-5 text-violet-400" />}
              iconClass="bg-violet-500/15"
              title="My Passes"
              subtitle={
                livePasses.length > 0
                  ? `${livePasses.length} active pass${livePasses.length === 1 ? "" : "es"}`
                  : "Buy hours in bulk & share them"
              }
            />
          )}
          <HubTile
            href="/waitlist"
            icon={<Bell className="h-5 w-5 text-amber-400" />}
            iconClass="bg-amber-500/15"
            title="My Waitlist"
            subtitle="Get notified when slots open"
          />
          <HubTile
            href="/cafe/orders"
            icon={<Coffee className="h-5 w-5 text-orange-400" />}
            iconClass="bg-orange-500/15"
            title="Cafe Orders"
            subtitle="Your food & drink orders"
          />
          <HubTile
            href="/shop/orders"
            icon={<ShoppingBag className="h-5 w-5 text-sky-400" />}
            iconClass="bg-sky-500/15"
            title="Shop Orders"
            subtitle="Items you've bought at the venue"
          />
          {/* Chat tile — opens the global ChatWidget floating panel. */}
          <OpenChatButton className="group flex w-full items-center gap-3.5 rounded-2xl border border-zinc-800/80 bg-zinc-900/60 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-zinc-700 hover:bg-zinc-900 sm:col-span-2">
            <div className="rounded-xl bg-emerald-500/10 p-2.5">
              <MessageCircle className="h-5 w-5 text-emerald-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white">Arena Assistant</p>
              <p className="truncate text-xs text-zinc-500">
                Ask anything about courts, hours, or your bookings
              </p>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-zinc-700 transition-all group-hover:translate-x-0.5 group-hover:text-zinc-400" />
          </OpenChatButton>
        </div>
      </div>

      {/* ── Upcoming bookings ──────────────────────────────────────── */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500">
            Upcoming Sessions
          </h2>
          {upcomingBookings.length > 0 && (
            <Link
              href="/bookings"
              className="flex items-center gap-1 text-xs text-emerald-500 transition-colors hover:text-emerald-400"
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
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium text-white">
                          {sportInfo.name}
                        </p>
                        {isNext && (
                          <span className="shrink-0 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                            Next
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-zinc-500">
                        {customerFacingCourtLabel(booking.courtConfig.label, booking.wasBookedAsHalfCourt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className={`text-sm font-bold ${colors.text}`}>
                        {booking.payment?.method === "PASS"
                          ? "Pass"
                          : formatPrice(booking.totalAmount)}
                      </span>
                      <ChevronRight className="h-4 w-4 text-zinc-700 transition-all group-hover:translate-x-0.5 group-hover:text-zinc-400" />
                    </div>
                  </div>

                  {/* Bottom row: date + time */}
                  <div className="ml-[44px] mt-2 flex items-center gap-4 text-xs text-zinc-400">
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
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-12 text-center">
            <div className="mb-4 rounded-full bg-zinc-800/80 p-4">
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
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-500 transition-all hover:border-red-500/30 hover:bg-red-500/5 hover:text-red-400"
      />
    </div>
  );
}
