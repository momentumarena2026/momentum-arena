import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { SPORT_INFO, formatHour } from "@/lib/court-config";
import { formatPrice, formatBookingDate } from "@/lib/pricing";
import Link from "next/link";
import {
  Calendar,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronRight,
  RefreshCw,
  Sparkles,
  CalendarDays,
  IndianRupee,
  ArrowUpRight,
  CalendarPlus,
  Trophy,
} from "lucide-react";
import { BackButton } from "@/components/back-button";
import type { Sport, BookingStatus } from "@prisma/client";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Sport-themed tokens used for calendar chips, icons and accent colors on
// each booking card so different sports are visually distinguishable.
const SPORT_THEME: Record<
  Sport,
  { bg: string; border: string; text: string; ring: string; emoji: string }
> = {
  CRICKET: {
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    text: "text-emerald-300",
    ring: "hover:shadow-emerald-500/10",
    emoji: "🏏",
  },
  FOOTBALL: {
    bg: "bg-sky-500/10",
    border: "border-sky-500/30",
    text: "text-sky-300",
    ring: "hover:shadow-sky-500/10",
    emoji: "⚽",
  },
  PICKLEBALL: {
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    text: "text-amber-300",
    ring: "hover:shadow-amber-500/10",
    emoji: "🎾",
  },
  BADMINTON: {
    bg: "bg-violet-500/10",
    border: "border-violet-500/30",
    text: "text-violet-300",
    ring: "hover:shadow-violet-500/10",
    emoji: "🏸",
  },
};

// Status token palette used for the small status pill on each card.
const STATUS_TOKEN: Record<
  BookingStatus,
  {
    icon: typeof CheckCircle2;
    label: string;
    pillBg: string;
    pillBorder: string;
    pillText: string;
  }
> = {
  CONFIRMED: {
    icon: CheckCircle2,
    label: "Confirmed",
    pillBg: "bg-emerald-500/10",
    pillBorder: "border-emerald-500/30",
    pillText: "text-emerald-300",
  },
  PENDING: {
    icon: AlertCircle,
    label: "Pending",
    pillBg: "bg-yellow-500/10",
    pillBorder: "border-yellow-500/30",
    pillText: "text-yellow-300",
  },
  CANCELLED: {
    icon: XCircle,
    label: "Cancelled",
    pillBg: "bg-red-500/10",
    pillBorder: "border-red-500/30",
    pillText: "text-red-300",
  },
};

export default async function MyBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { filter } = await searchParams;
  const showOnlyRecurring = filter === "recurring";

  const [bookings, recurringBookings] = await Promise.all([
    db.booking.findMany({
      where: { userId: session.user.id },
      include: {
        courtConfig: true,
        slots: { orderBy: { startHour: "asc" } },
        payment: true,
        feedback: { select: { rating: true } },
        recurringBooking: { select: { id: true, dayOfWeek: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.recurringBooking.findMany({
      where: {
        userId: session.user.id,
        status: { in: ["ACTIVE", "PAUSED"] },
      },
      include: {
        courtConfig: { select: { sport: true, size: true, label: true } },
        bookings: {
          where: { date: { gte: new Date() }, status: "CONFIRMED" },
          orderBy: { date: "asc" },
          take: 3,
          select: { id: true, date: true, totalAmount: true },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const now = new Date();
  const upcoming = bookings.filter(
    (b) => (b.status === "CONFIRMED" || b.status === "PENDING") && b.date >= now
  );
  const past = bookings.filter(
    (b) => (b.status !== "CONFIRMED" && b.status !== "PENDING") || b.date < now
  );

  // Dashboard stats
  const confirmedCount = bookings.filter((b) => b.status === "CONFIRMED").length;
  const totalSpent = bookings
    .filter((b) => b.status === "CONFIRMED" || b.status === "PENDING")
    .reduce((sum, b) => sum + b.totalAmount, 0);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackButton
        className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors"
        label="Back"
      />

      {/* ─── Hero Header ─────────────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-3xl border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-950 p-6 md:p-8">
        {/* Decorative blobs */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-emerald-500/20 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-28 -left-28 h-72 w-72 rounded-full bg-sky-500/10 blur-3xl"
        />

        <div className="relative">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-emerald-400" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-300/90">
              Your Playtime
            </p>
          </div>
          <h1 className="mt-2 text-3xl font-bold text-white md:text-4xl">
            {showOnlyRecurring ? "Recurring Series" : "My Bookings"}
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            {showOnlyRecurring
              ? `${recurringBookings.length} active ${recurringBookings.length === 1 ? "series" : "series"}`
              : `${bookings.length} total · ${upcoming.length} upcoming · ${recurringBookings.length} recurring`}
          </p>

          {!showOnlyRecurring && bookings.length > 0 && (
            <div className="mt-6 grid grid-cols-3 gap-2.5 md:gap-3">
              <StatCard
                icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
                label="Confirmed"
                value={String(confirmedCount)}
              />
              <StatCard
                icon={<CalendarDays className="h-3.5 w-3.5 text-sky-400" />}
                label="Upcoming"
                value={String(upcoming.length)}
              />
              <StatCard
                icon={<IndianRupee className="h-3.5 w-3.5 text-amber-400" />}
                label="Spent"
                value={formatPrice(totalSpent)}
              />
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-2">
            <Link
              href="/book"
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
            >
              <CalendarPlus className="h-4 w-4" />
              Book a Court
            </Link>
            {!showOnlyRecurring && recurringBookings.length > 0 && (
              <Link
                href="/bookings?filter=recurring"
                className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-800/60 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800"
              >
                <RefreshCw className="h-4 w-4" />
                Recurring Only
              </Link>
            )}
            {showOnlyRecurring && (
              <Link
                href="/bookings"
                className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-800/60 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800"
              >
                Show All
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* ─── Recurring Series ────────────────────────────────────────── */}
      {recurringBookings.length > 0 && (
        <section>
          <SectionHeader
            icon={<RefreshCw className="h-3 w-3 text-sky-400" />}
            title="Recurring Series"
          />
          <div className="space-y-3">
            {recurringBookings.map((recurring) => (
              <RecurringCard
                key={recurring.id}
                id={recurring.id}
                sport={recurring.courtConfig.sport}
                courtLabel={recurring.courtConfig.label}
                dayOfWeek={recurring.dayOfWeek}
                startHour={recurring.startHour}
                endHour={recurring.endHour}
                status={recurring.status}
                bookings={recurring.bookings}
              />
            ))}
          </div>
        </section>
      )}

      {/* Empty state for recurring-only filter */}
      {showOnlyRecurring && recurringBookings.length === 0 && (
        <EmptyState
          icon={<RefreshCw className="h-12 w-12 text-zinc-600" />}
          title="No recurring series yet"
          subtitle="Create a recurring booking when selecting your slots."
          ctaLabel="Book a Court"
          ctaHref="/book"
        />
      )}

      {/* ─── Bookings List ───────────────────────────────────────────── */}
      {!showOnlyRecurring && bookings.length === 0 && (
        <EmptyState
          icon={<Calendar className="h-12 w-12 text-zinc-600" />}
          title="No bookings yet"
          subtitle="Your first game is just a couple of taps away."
          ctaLabel="Book a Court"
          ctaHref="/book"
        />
      )}

      {!showOnlyRecurring && bookings.length > 0 && (
        <div className="space-y-6">
          {upcoming.length > 0 && (
            <section>
              <SectionHeader
                icon={<CalendarDays className="h-3 w-3 text-emerald-400" />}
                title="Upcoming"
                count={upcoming.length}
              />
              <div className="space-y-3">
                {upcoming.map((booking) => (
                  <BookingCard key={booking.id} booking={booking} past={false} />
                ))}
              </div>
            </section>
          )}

          {past.length > 0 && (
            <section>
              <SectionHeader
                icon={<Clock className="h-3 w-3 text-zinc-500" />}
                title="Previous"
                count={past.length}
              />
              <div className="space-y-3">
                {past.map((booking) => (
                  <BookingCard key={booking.id} booking={booking} past />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-black/40 p-3 backdrop-blur">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-zinc-500">
        {icon}
        <span>{label}</span>
      </div>
      <p className="mt-1 truncate text-lg font-bold text-white md:text-xl">
        {value}
      </p>
    </div>
  );
}

function SectionHeader({
  icon,
  title,
  count,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <div className="rounded-md bg-zinc-800/80 p-1">{icon}</div>
      <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">
        {title}
      </h2>
      {count !== undefined && (
        <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
          {count}
        </span>
      )}
      <div className="ml-2 h-px flex-1 bg-gradient-to-r from-zinc-800 to-transparent" />
    </div>
  );
}

function EmptyState({
  icon,
  title,
  subtitle,
  ctaLabel,
  ctaHref,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaHref: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-900 to-zinc-950 p-12 text-center">
      <div className="mx-auto inline-flex rounded-2xl bg-zinc-800/60 p-3">
        {icon}
      </div>
      <p className="mt-4 text-base font-semibold text-white">{title}</p>
      <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>
      <Link
        href={ctaHref}
        className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
      >
        <CalendarPlus className="h-4 w-4" />
        {ctaLabel}
      </Link>
    </div>
  );
}

function DateChip({
  date,
  theme,
  muted,
}: {
  date: Date;
  theme: (typeof SPORT_THEME)[Sport];
  muted?: boolean;
}) {
  const day = formatBookingDate(date, { day: "numeric" });
  const month = formatBookingDate(date, { month: "short" }).toUpperCase();
  const weekday = formatBookingDate(date, { weekday: "short" });

  return (
    <div
      className={`flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl border ${
        muted ? "border-zinc-800 bg-zinc-900/60" : `${theme.border} ${theme.bg}`
      }`}
    >
      <span
        className={`text-[10px] font-bold uppercase tracking-widest leading-none ${
          muted ? "text-zinc-500" : theme.text
        }`}
      >
        {month}
      </span>
      <span
        className={`mt-0.5 text-2xl font-bold leading-none ${
          muted ? "text-zinc-400" : "text-white"
        }`}
      >
        {day}
      </span>
      <span className="mt-0.5 text-[9px] font-medium uppercase tracking-wide text-zinc-500">
        {weekday}
      </span>
    </div>
  );
}

type BookingWithIncludes = Awaited<
  ReturnType<typeof db.booking.findMany>
>[number] & {
  courtConfig: { sport: Sport; label: string };
  slots: { startHour: number }[];
  recurringBooking: { id: string } | null;
};

function BookingCard({
  booking,
  past,
}: {
  booking: BookingWithIncludes;
  past: boolean;
}) {
  const sportInfo = SPORT_INFO[booking.courtConfig.sport];
  const theme = SPORT_THEME[booking.courtConfig.sport];
  const status = STATUS_TOKEN[booking.status];
  const StatusIcon = status.icon;
  const muted = past && booking.status === "CANCELLED";

  const timeRange = booking.slots
    .map((s) => formatHour(s.startHour))
    .join(", ");

  return (
    <Link
      href={`/book/confirmation/${booking.id}`}
      className={`group relative block overflow-hidden rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-900 to-zinc-950 p-4 transition-all hover:border-zinc-700 hover:shadow-lg ${
        theme.ring
      } ${muted ? "opacity-70 hover:opacity-100" : ""}`}
    >
      {/* Subtle sport-colored edge glow on hover */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 left-0 w-1 ${theme.bg} opacity-0 transition-opacity group-hover:opacity-100`}
      />

      <div className="flex items-center gap-4">
        <DateChip date={booking.date} theme={theme} muted={muted} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base leading-none">{theme.emoji}</span>
            <p className="truncate font-semibold text-white">{sportInfo.name}</p>
            <span className={`text-xs ${muted ? "text-zinc-600" : "text-zinc-500"}`}>
              {booking.courtConfig.label}
            </span>
            {booking.recurringBooking && (
              <span className="inline-flex items-center gap-0.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-sky-300">
                <RefreshCw className="h-2.5 w-2.5" />
                Series
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-lg bg-zinc-800/70 px-2 py-1 text-xs font-medium text-zinc-300">
              <Clock className="h-3 w-3 text-zinc-500" />
              {timeRange}
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${status.pillBg} ${status.pillBorder} ${status.pillText}`}
            >
              <StatusIcon className="h-3 w-3" />
              {status.label}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={`text-base font-bold ${
              muted ? "text-zinc-400" : "text-white"
            }`}
          >
            {formatPrice(booking.totalAmount)}
          </span>
          <ChevronRight className="h-4 w-4 text-zinc-600 transition-all group-hover:translate-x-0.5 group-hover:text-zinc-300" />
        </div>
      </div>
    </Link>
  );
}

function RecurringCard({
  sport,
  courtLabel,
  dayOfWeek,
  startHour,
  endHour,
  status,
  bookings,
}: {
  id: string;
  sport: Sport;
  courtLabel: string;
  dayOfWeek: number;
  startHour: number;
  endHour: number;
  status: string;
  bookings: { id: string; date: Date; totalAmount: number }[];
}) {
  const sportInfo = SPORT_INFO[sport];
  const theme = SPORT_THEME[sport];
  const isActive = status === "ACTIVE";

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-950 p-5 transition-all hover:border-sky-500/30">
      {/* Decorative blob */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-sky-500/10 blur-3xl"
      />

      <div className="relative flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border text-2xl ${theme.bg} ${theme.border}`}
          >
            {theme.emoji}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate font-semibold text-white">
                {sportInfo.name}
              </p>
              <span className="text-xs text-zinc-500">{courtLabel}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/20 bg-sky-500/10 px-2.5 py-1 text-xs font-medium text-sky-300">
                <Calendar className="h-3 w-3" />
                Every {DAY_NAMES[dayOfWeek]}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-800/70 px-2.5 py-1 text-xs font-medium text-zinc-300">
                <Clock className="h-3 w-3 text-zinc-500" />
                {formatHour(startHour)} – {formatHour(endHour)}
              </span>
            </div>
          </div>
        </div>

        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
            isActive
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-yellow-500/30 bg-yellow-500/10 text-yellow-300"
          }`}
        >
          {isActive && <Sparkles className="h-2.5 w-2.5" />}
          {status}
        </span>
      </div>

      {bookings.length > 0 && (
        <div className="relative mt-4 border-t border-zinc-800/80 pt-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Next up
          </p>
          <div className="flex flex-wrap gap-2">
            {bookings.map((b) => (
              <Link
                key={b.id}
                href={`/book/confirmation/${b.id}`}
                className="group/chip inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800/60 px-2.5 py-1 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-white"
              >
                {formatBookingDate(b.date, { day: "numeric", month: "short" })}
                <ArrowUpRight className="h-3 w-3 -translate-x-1 opacity-0 transition-all group-hover/chip:translate-x-0 group-hover/chip:opacity-100" />
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
