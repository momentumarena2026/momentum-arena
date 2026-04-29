"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Lock,
  RotateCcw,
  X,
} from "lucide-react";
import {
  getCalendarData,
  type CalendarData,
  type CellBooking,
} from "@/actions/admin-calendar";
import { formatHourCompact, formatHoursAsRanges } from "@/lib/court-config";
import { formatPrice } from "@/lib/pricing";
import { getTodayIST } from "@/lib/ist-date";
import type { Sport } from "@prisma/client";

const SPORT_CHIPS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "CRICKET", label: "Cricket" },
  { value: "FOOTBALL", label: "Football" },
  { value: "PICKLEBALL", label: "Pickleball" },
];

// Per-sport visual palette — same accents the mobile calendar uses
// so the two surfaces feel identical. Each entry exposes the emoji,
// a tinted background, and a contrast-friendly text colour for the
// sport chip pill.
const SPORT_STYLE: Record<
  Sport,
  { emoji: string; chip: string; text: string }
> = {
  CRICKET: {
    emoji: "🏏",
    chip: "border-emerald-500/40 bg-emerald-500/15",
    text: "text-emerald-300",
  },
  FOOTBALL: {
    emoji: "⚽",
    chip: "border-blue-500/40 bg-blue-500/15",
    text: "text-blue-300",
  },
  PICKLEBALL: {
    emoji: "🏓",
    chip: "border-purple-500/40 bg-purple-500/15",
    text: "text-purple-300",
  },
};

interface CalendarViewProps {
  initialDate: string;
  initialData: CalendarData;
}

/**
 * Calendar-style hour grid for one date. Mirrors the mobile redesign:
 * a responsive grid of cells (2 cols on phones, 3 on tablets, 4–5 on
 * desktop) where each cell represents one hour slot. The cell shows
 * the time range at top and a chip per booking touching that hour,
 * coloured by sport. Empty hours render with only the time label so
 * staff can scan availability at a glance.
 *
 * The previous wide-table layout (hours × courts) is gone — the
 * court column doubled the screen-real-estate cost while only
 * marginally informing the floor-staff workflow ("which slots are
 * free, who's coming in"). The court is now surfaced inside each
 * chip's secondary line.
 */
export function CalendarView({ initialDate, initialData }: CalendarViewProps) {
  const [date, setDate] = useState(initialDate);
  const [sportFilter, setSportFilter] = useState("");
  const [data, setData] = useState<CalendarData>(initialData);
  const [isPending, startTransition] = useTransition();
  const [selectedBooking, setSelectedBooking] = useState<{
    booking: CellBooking;
    courtLabel: string;
  } | null>(null);

  // Re-fetch when date or sport filter changes
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

  function handleSportChange(newSport: string) {
    setSportFilter(newSport);
    fetchData(date, newSport);
  }

  function navigateDay(offset: number) {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() + offset);
    const newDate = d.toISOString().split("T")[0];
    handleDateChange(newDate);
  }

  // Pivot configId × hour → list of bookings per hour. Bookings that
  // overlap multiple courts (zone-overlap) are deduped by id so the
  // same booking yields one chip per hour, not one per court.
  const hourMap = useMemo(() => buildHourMap(data), [data]);

  // "29 Apr Wed" — the calendar's hero label. Replaces the
  // wide-table month/year header from the previous layout.
  const heroLabel = useMemo(() => {
    const d = new Date(date + "T12:00:00");
    return d.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      weekday: "short",
      timeZone: "Asia/Kolkata",
    });
  }, [date]);

  const isToday = date === getTodayIST();
  const nowHour = new Date().getHours();

  return (
    <div className="space-y-4">
      {/* Date hero — prev | label + date input + Today | next */}
      <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigateDay(-1)}
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
          {!isToday && (
            <button
              type="button"
              onClick={() => handleDateChange(getTodayIST())}
              className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
            >
              <RotateCcw className="h-3 w-3" />
              Today
            </button>
          )}
          <button
            type="button"
            onClick={() => navigateDay(1)}
            className="rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
            aria-label="Next day"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {isPending && (
            <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
          )}
        </div>

        {/* Sport filter chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          {SPORT_CHIPS.map((chip) => {
            const active = sportFilter === chip.value;
            return (
              <button
                key={chip.value}
                type="button"
                onClick={() => handleSportChange(chip.value)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "border-yellow-500/40 bg-yellow-500/15 text-yellow-300"
                    : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Grid */}
      {data.hours.length === 0 || data.configs.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-12 text-center">
          <p className="text-zinc-400">
            Nothing to show
            {sportFilter ? " for this sport" : ""}.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {data.hours.map((hour) => {
            const entry = hourMap.get(hour);
            const isCurrentHour = isToday && hour === nowHour;
            return (
              <HourCell
                key={hour}
                hour={hour}
                entry={entry}
                isCurrentHour={isCurrentHour}
                date={date}
                onSelectBooking={(booking, courtLabel) =>
                  setSelectedBooking({ booking, courtLabel })
                }
              />
            );
          })}
        </div>
      )}

      {/* Booking detail modal — preserved from the previous layout
          because clicking a chip is the primary inspect-a-booking
          interaction on this page. */}
      {selectedBooking && (
        <BookingDetailModal
          booking={selectedBooking.booking}
          courtLabel={selectedBooking.courtLabel}
          onClose={() => setSelectedBooking(null)}
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

// --------------------------------------------------------------------------
// Hour cell

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

interface HourCellProps {
  hour: number;
  entry?: HourEntry;
  isCurrentHour: boolean;
  date: string;
  onSelectBooking: (booking: CellBooking, courtLabel: string) => void;
}

function HourCell({
  hour,
  entry,
  isCurrentHour,
  date,
  onSelectBooking,
}: HourCellProps) {
  const isEmpty = !entry || (entry.bookings.length === 0 && entry.blocks.length === 0);
  const cellClasses = [
    "flex min-h-[110px] flex-col gap-1.5 rounded-lg border p-3 transition-colors",
    isCurrentHour
      ? "border-emerald-500/40 bg-emerald-500/5"
      : "border-zinc-800 bg-zinc-900",
  ].join(" ");

  return (
    <div className={cellClasses}>
      {/* Time label — top of the cell, like the date number on a
          conventional monthly calendar's day cell. */}
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

      {/* Body — empty when nothing's booked / blocked, with a subtle
          "create" affordance on hover. Otherwise, one chip per
          booking + a Blocked pill if any. */}
      {isEmpty ? (
        <Link
          href={`/admin/bookings/create?date=${date}&hour=${hour}`}
          className="flex flex-1 items-center justify-center rounded-md border border-dashed border-zinc-800 text-[10px] text-zinc-700 transition-colors hover:border-zinc-700 hover:text-zinc-500"
        >
          + Add
        </Link>
      ) : (
        <div className="flex flex-col gap-1">
          {entry!.blocks.length > 0 && (
            <div className="flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-[10px] font-medium text-red-300">
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
                onClick={() => onSelectBooking(booking, courtLabel)}
                className={`flex flex-col items-start gap-0.5 rounded-md border px-2 py-1 text-left transition-all hover:brightness-125 ${
                  palette.chip
                } ${dashed ? "border-dashed" : ""}`}
              >
                <span
                  className={`text-[11px] font-semibold ${palette.text}`}
                >
                  {palette.emoji} {sportName(sport)}
                </span>
                <span
                  className={`text-[10px] opacity-80 ${palette.text} truncate w-full`}
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

function sportName(sport: Sport): string {
  return sport.charAt(0) + sport.slice(1).toLowerCase();
}

// --------------------------------------------------------------------------
// Legend chip

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

// --------------------------------------------------------------------------
// BookingDetailModal — unchanged from the previous layout. Click-
// through from a chip surfaces the same dialog so admin muscle memory
// from the table-style view carries over.

interface BookingDetailModalProps {
  booking: CellBooking;
  courtLabel: string;
  onClose: () => void;
}

function BookingDetailModal({
  booking,
  courtLabel,
  onClose,
}: BookingDetailModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h3 className="text-sm font-semibold text-white">Booking Details</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <DetailRow label="Booking ID" value={booking.id} mono />
          <DetailRow label="Customer" value={booking.userName} />
          {booking.userEmail && (
            <DetailRow label="Email" value={booking.userEmail} />
          )}
          {booking.userPhone && (
            <DetailRow label="Phone" value={booking.userPhone} />
          )}
          <DetailRow label="Court" value={courtLabel} />
          <DetailRow
            label="Status"
            value={
              <span
                className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                  booking.status === "CONFIRMED"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : "border-yellow-500/30 bg-yellow-500/10 text-yellow-400"
                }`}
              >
                {booking.status}
              </span>
            }
          />
          <DetailRow label="Slots" value={formatHoursAsRanges(booking.slots)} />
          <DetailRow label="Amount" value={formatPrice(booking.totalAmount)} />
          {booking.paymentStatus && (
            <DetailRow
              label="Payment"
              value={`${booking.paymentStatus} (${booking.paymentMethod?.replace("_", " ")})`}
            />
          )}
        </div>
        <div className="border-t border-zinc-800 px-5 py-3">
          <Link
            href={`/admin/bookings/${booking.id}`}
            className="flex items-center justify-center gap-2 rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View Full Booking
          </Link>
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="shrink-0 text-xs text-zinc-500">{label}</span>
      <span
        className={`text-right text-xs text-zinc-200 ${mono ? "font-mono text-[10px]" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
