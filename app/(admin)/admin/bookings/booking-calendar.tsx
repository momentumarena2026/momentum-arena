"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  List,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import {
  getCalendarData,
  type CalendarData,
  type CellBooking,
} from "@/actions/admin-calendar";
import {
  formatHourCompact,
  formatHourRangeCompact,
  formatHoursAsRanges,
} from "@/lib/court-config";
import { formatPrice } from "@/lib/pricing";
import type { Sport } from "@prisma/client";

// --------------- Constants ---------------

// Per-sport visual palette — same accents as the mobile calendar
// redesign so the two surfaces feel identical. Each entry is a
// Tailwind class fragment for the chip background + a text colour.
const SPORT_STYLE: Record<
  Sport,
  { emoji: string; chip: string; text: string; dot: string }
> = {
  CRICKET: {
    emoji: "🏏",
    chip: "border-emerald-500/40 bg-emerald-500/15",
    text: "text-emerald-300",
    dot: "bg-emerald-500",
  },
  FOOTBALL: {
    emoji: "⚽",
    chip: "border-blue-500/40 bg-blue-500/15",
    text: "text-blue-300",
    dot: "bg-blue-500",
  },
  PICKLEBALL: {
    emoji: "🏓",
    chip: "border-purple-500/40 bg-purple-500/15",
    text: "text-purple-300",
    dot: "bg-purple-500",
  },
};

const SPORT_LABELS: Record<Sport, string> = {
  CRICKET: "Cricket",
  FOOTBALL: "Football",
  PICKLEBALL: "Pickleball",
};

const SPORT_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "CRICKET", label: "Cricket" },
  { value: "FOOTBALL", label: "Football" },
  { value: "PICKLEBALL", label: "Pickleball" },
];

// --------------- Date helpers ---------------

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isToday(dateStr: string): boolean {
  return dateStr === toDateStr(new Date());
}

function getCurrentHour(): number {
  return new Date().getHours();
}

function shiftDate(dateStr: string, days: number): string {
  // Local-time arithmetic — input/output both flow through local
  // year/month/day fields, so the round-trip is consistent. (The
  // mobile/calendar-view stepper bug came from mixing local
  // construction with UTC `toISOString()`, which we don't do here.)
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return toDateStr(dt);
}

function formatHero(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    weekday: "short",
  });
}

// --------------- Hour pivot ---------------

interface HourEntry {
  bookings: Array<{
    booking: CellBooking;
    sport: Sport;
    courtLabel: string;
  }>;
  blocks: Array<{ courtLabel: string; reason?: string }>;
}

function buildHourMap(data: CalendarData): Map<number, HourEntry> {
  const map = new Map<number, HourEntry>();
  for (const h of data.hours) map.set(h, { bookings: [], blocks: [] });

  for (const config of data.configs) {
    const row = data.grid[config.id] ?? {};
    for (const [hStr, cell] of Object.entries(row)) {
      const h = Number(hStr);
      const entry = map.get(h);
      if (!entry) continue;

      if (cell.booking) {
        // Multiple courts can register the same booking when zones
        // overlap. Dedup by booking id so each booking surfaces as
        // exactly one chip per hour cell.
        if (!entry.bookings.some((b) => b.booking.id === cell.booking!.id)) {
          entry.bookings.push({
            booking: cell.booking,
            sport: config.sport,
            courtLabel: config.label,
          });
        }
      }
      if (cell.blocked) {
        entry.blocks.push({
          courtLabel: config.label,
          reason: cell.blockReason,
        });
      }
    }
  }
  return map;
}

// --------------- Main component ---------------

interface BookingCalendarProps {
  initialData: CalendarData;
  initialDate: string;
  onViewChange?: (view: "list") => void;
}

export default function BookingCalendar({
  initialData,
  initialDate,
}: BookingCalendarProps) {
  const [data, setData] = useState<CalendarData>(initialData);
  const [date, setDate] = useState(initialDate);
  const [sportFilter, setSportFilter] = useState("");
  const [isPending, startTransition] = useTransition();

  const [selectedBooking, setSelectedBooking] = useState<{
    booking: CellBooking;
    sport: Sport;
    courtLabel: string;
  } | null>(null);
  const [quickBookHour, setQuickBookHour] = useState<number | null>(null);

  const fetchData = useCallback((newDate: string, newSport: string) => {
    startTransition(async () => {
      const result = await getCalendarData(newDate, newSport || undefined);
      setData(result);
    });
  }, []);

  function handleDateChange(newDate: string) {
    setDate(newDate);
    fetchData(newDate, sportFilter);
  }

  function handleSportChange(sport: string) {
    setSportFilter(sport);
    fetchData(date, sport);
  }

  function handleToday() {
    const today = toDateStr(new Date());
    setDate(today);
    fetchData(today, sportFilter);
  }

  const hourMap = useMemo(() => buildHourMap(data), [data]);
  const heroLabel = useMemo(() => formatHero(date), [date]);
  const isOnToday = isToday(date);
  const nowHour = getCurrentHour();

  return (
    <div className="space-y-4">
      {/* Header / controls */}
      <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Date stepper */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleDateChange(shiftDate(date, -1))}
            className="rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
            aria-label="Previous day"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2 px-1">
            <CalendarDays className="h-4 w-4 text-yellow-400" />
            <span className="text-lg font-semibold text-white">
              {heroLabel}
            </span>
          </div>
          <input
            type="date"
            value={date}
            onChange={(e) => handleDateChange(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          {!isOnToday && (
            <button
              type="button"
              onClick={handleToday}
              className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
            >
              <RotateCcw className="h-3 w-3" />
              Today
            </button>
          )}
          <button
            type="button"
            onClick={() => handleDateChange(shiftDate(date, 1))}
            className="rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
            aria-label="Next day"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {isPending && (
            <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Sport filter */}
          <div className="flex flex-wrap items-center gap-1.5">
            {SPORT_FILTERS.map((sf) => {
              const active = sportFilter === sf.value;
              return (
                <button
                  key={sf.value}
                  type="button"
                  onClick={() => handleSportChange(sf.value)}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? "border-yellow-500/40 bg-yellow-500/15 text-yellow-300"
                      : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-800"
                  }`}
                >
                  {sf.value && (
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        SPORT_STYLE[sf.value as Sport]?.dot ?? ""
                      }`}
                    />
                  )}
                  {sf.label}
                </button>
              );
            })}
          </div>

          {/* View toggle (Calendar / Table) — preserved from the old
              layout so admins can still drop into the bookings table
              when they want to slice the data. */}
          <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-md bg-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-400"
            >
              <CalendarDays className="h-3.5 w-3.5" />
              Calendar
            </button>
            <Link
              href="/admin/bookings"
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-300"
            >
              <List className="h-3.5 w-3.5" />
              Table
            </Link>
          </div>
        </div>
      </div>

      {/* Grid — responsive 2/3/4/5 cols, one cell per hour */}
      {data.hours.length === 0 || data.configs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 py-20 text-zinc-500">
          <CalendarDays className="mb-3 h-10 w-10 text-zinc-600" />
          <p className="text-sm">Nothing to show</p>
          <p className="mt-1 text-xs text-zinc-600">
            Try a different sport filter
          </p>
        </div>
      ) : (
        <div className="relative">
          {isPending && (
            <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-zinc-950/40 backdrop-blur-[1px]">
              <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {data.hours.map((hour) => {
              const entry = hourMap.get(hour);
              const isCurrentHour = isOnToday && hour === nowHour;
              return (
                <HourCell
                  key={hour}
                  hour={hour}
                  entry={entry}
                  isCurrentHour={isCurrentHour}
                  onSelectBooking={(booking, sport, courtLabel) =>
                    setSelectedBooking({ booking, sport, courtLabel })
                  }
                  onEmptyClick={() => setQuickBookHour(hour)}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Booking detail modal (chip click) */}
      {selectedBooking && (
        <BookingDetailModal
          booking={selectedBooking.booking}
          sport={selectedBooking.sport}
          courtLabel={selectedBooking.courtLabel}
          date={date}
          onClose={() => setSelectedBooking(null)}
        />
      )}

      {/* Quick book modal (empty-cell click) — opens a date+hour
          prefilled link to /admin/bookings/create. The cell-per-hour
          layout doesn't bind to a specific court, so the user picks
          the court on the create form. */}
      {quickBookHour !== null && (
        <QuickBookModal
          hour={quickBookHour}
          date={date}
          onClose={() => setQuickBookHour(null)}
        />
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-500">
        <Legend className="border-emerald-500/40 bg-emerald-500/15">
          🏏 Cricket
        </Legend>
        <Legend className="border-blue-500/40 bg-blue-500/15">
          ⚽ Football
        </Legend>
        <Legend className="border-purple-500/40 bg-purple-500/15">
          🏓 Pickleball
        </Legend>
        <Legend className="border-yellow-500/40 bg-yellow-500/15">
          Pending (dashed)
        </Legend>
        <Legend className="border-red-500/30 bg-red-500/10">Blocked</Legend>
      </div>
    </div>
  );
}

// --------------- HourCell ---------------

function HourCell({
  hour,
  entry,
  isCurrentHour,
  onSelectBooking,
  onEmptyClick,
}: {
  hour: number;
  entry?: HourEntry;
  isCurrentHour: boolean;
  onSelectBooking: (
    booking: CellBooking,
    sport: Sport,
    courtLabel: string,
  ) => void;
  onEmptyClick: () => void;
}) {
  const isEmpty = !entry || (entry.bookings.length === 0 && entry.blocks.length === 0);

  return (
    <div
      className={`flex min-h-[110px] flex-col gap-1.5 rounded-lg border p-3 transition-colors ${
        isCurrentHour
          ? "border-emerald-500/40 bg-emerald-500/5"
          : "border-zinc-800 bg-zinc-900"
      }`}
    >
      <div className="flex items-center justify-between">
        <span
          className={`text-xs font-semibold ${
            isCurrentHour ? "text-emerald-400" : "text-zinc-400"
          }`}
        >
          {formatHourCompact(hour)} – {formatHourCompact(hour + 1)}
        </span>
        {isCurrentHour && (
          <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-400">
            Now
          </span>
        )}
      </div>

      {isEmpty ? (
        <button
          type="button"
          onClick={onEmptyClick}
          className="flex flex-1 items-center justify-center rounded-md border border-dashed border-zinc-800 text-[10px] text-zinc-700 transition-colors hover:border-zinc-700 hover:text-zinc-500"
        >
          <Plus className="h-3 w-3" />
          <span className="ml-1">Add</span>
        </button>
      ) : (
        <div className="flex flex-col gap-1">
          {entry!.blocks.length > 0 && (
            <div
              className="flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-[10px] font-medium text-red-300"
              title={entry!.blocks.map((b) => b.courtLabel).join(", ")}
            >
              <Lock className="h-3 w-3" />
              <span className="truncate">
                {entry!.blocks[0].reason || "Blocked"}
                {entry!.blocks.length > 1 ? ` +${entry!.blocks.length - 1}` : ""}
              </span>
            </div>
          )}
          {entry!.bookings.map(({ booking, sport, courtLabel }) => {
            const palette = SPORT_STYLE[sport];
            const dashed = booking.status === "PENDING";
            return (
              <button
                key={booking.id}
                type="button"
                onClick={() => onSelectBooking(booking, sport, courtLabel)}
                className={`flex flex-col items-start gap-0.5 rounded-md border px-2 py-1 text-left transition-all hover:brightness-125 ${
                  palette.chip
                } ${dashed ? "border-dashed" : ""}`}
              >
                <span className={`text-[11px] font-semibold ${palette.text}`}>
                  {palette.emoji} {SPORT_LABELS[sport]}
                </span>
                <span
                  className={`w-full truncate text-[10px] opacity-80 ${palette.text}`}
                >
                  {courtLabel}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --------------- Legend chip ---------------

function Legend({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  return (
    <span className={`flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] ${className}`}>
      {children}
    </span>
  );
}

// --------------- BookingDetailModal ---------------

function BookingDetailModal({
  booking,
  sport,
  courtLabel,
  date,
  onClose,
}: {
  booking: CellBooking;
  sport: Sport;
  courtLabel: string;
  date: string;
  onClose: () => void;
}) {
  const palette = SPORT_STYLE[sport];
  const isConfirmed = booking.status === "CONFIRMED";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="animate-in fade-in zoom-in-95 relative w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl duration-200">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h3 className="text-base font-semibold text-white">Booking Details</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
                isConfirmed
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                  : "border-yellow-500/30 bg-yellow-500/10 text-yellow-400"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  isConfirmed ? "bg-emerald-400" : "bg-yellow-400"
                }`}
              />
              {isConfirmed ? "Confirmed" : "Pending"}
            </span>
            {booking.paymentStatus && (
              <span
                className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                  booking.paymentStatus === "COMPLETED"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : booking.paymentStatus === "PENDING"
                      ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-400"
                      : "border-zinc-700 bg-zinc-800 text-zinc-400"
                }`}
              >
                {booking.paymentStatus}
                {booking.paymentMethod &&
                  ` · ${booking.paymentMethod.replace("_", " ")}`}
              </span>
            )}
          </div>

          <div className="space-y-1.5 rounded-xl border border-zinc-800 bg-zinc-950 p-3">
            <p className="text-sm font-medium text-white">{booking.userName}</p>
            {booking.userEmail && (
              <p className="text-xs text-zinc-400">{booking.userEmail}</p>
            )}
            {booking.userPhone && (
              <p className="text-xs text-zinc-400">{booking.userPhone}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <InfoBlock label="Sport">
              <span className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${palette.dot}`} />
                {SPORT_LABELS[sport]}
              </span>
            </InfoBlock>
            <InfoBlock label="Court">{courtLabel}</InfoBlock>
            <InfoBlock label="Date">{formatHero(date)}</InfoBlock>
            <InfoBlock label="Time">
              {formatHoursAsRanges(booking.slots)}
            </InfoBlock>
            <InfoBlock label="Amount">
              <span className="font-semibold text-emerald-400">
                {formatPrice(booking.totalAmount)}
              </span>
            </InfoBlock>
            <InfoBlock label="Booking ID">
              <span className="font-mono text-[10px]">
                {booking.id.slice(0, 8)}…
              </span>
            </InfoBlock>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-zinc-800 px-5 py-4">
          <Link
            href={`/admin/bookings/${booking.id}`}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View Full Details
          </Link>
          <Link
            href={`/admin/bookings/${booking.id}/edit`}
            className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Link>
        </div>
      </div>
    </div>
  );
}

// --------------- QuickBookModal ---------------

function QuickBookModal({
  hour,
  date,
  onClose,
}: {
  hour: number;
  date: string;
  onClose: () => void;
}) {
  // No court is selected from the cell (the new layout aggregates
  // hours, not court×hour combos). The create form lets the user
  // pick a court that's free for this date+hour.
  const createUrl = `/admin/bookings/create?date=${date}&hour=${hour}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="animate-in fade-in zoom-in-95 relative w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl duration-200">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h3 className="text-base font-semibold text-white">Quick Book</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <InfoBlock label="Date">{formatHero(date)}</InfoBlock>
            <InfoBlock label="Time">{formatHourRangeCompact(hour)}</InfoBlock>
          </div>
          <p className="text-xs text-zinc-500">
            Pick a court on the next screen — only courts that are free
            in this slot will be selectable.
          </p>
        </div>

        <div className="border-t border-zinc-800 px-5 py-4">
          <Link
            href={createUrl}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" />
            Continue
          </Link>
        </div>
      </div>
    </div>
  );
}

// --------------- InfoBlock ---------------

function InfoBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
      <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </p>
      <p className="text-xs text-zinc-200">{children}</p>
    </div>
  );
}
