"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  X,
  ExternalLink,
  Pencil,
  List,
  CalendarDays,
  Loader2,
} from "lucide-react";
import {
  getCalendarData,
  type CalendarData,
  type CellBooking,
  type CalendarConfig,
} from "@/actions/admin-calendar";
import { formatHourCompact, formatHourRangeCompact, formatHoursAsRanges } from "@/lib/court-config";
import { formatPrice } from "@/lib/pricing";

// --------------- Constants ---------------

const SPORT_COLORS: Record<string, string> = {
  CRICKET: "#10b981",
  FOOTBALL: "#3b82f6",
  PICKLEBALL: "#f59e0b",
  BADMINTON: "#ef4444",
};

const SPORT_LABELS: Record<string, string> = {
  CRICKET: "Cricket",
  FOOTBALL: "Football",
  PICKLEBALL: "Pickleball",
  BADMINTON: "Badminton",
};

const SPORT_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "CRICKET", label: "Cricket" },
  { value: "FOOTBALL", label: "Football" },
  { value: "PICKLEBALL", label: "Pickleball" },
  { value: "BADMINTON", label: "Badminton" },
];

// --------------- Helpers ---------------

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateDisplay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function isToday(dateStr: string): boolean {
  return dateStr === toDateStr(new Date());
}

function getCurrentHour(): number {
  return new Date().getHours();
}

function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return toDateStr(dt);
}

// --------------- Component ---------------

interface BookingCalendarProps {
  initialData: CalendarData;
  initialDate: string;
  onViewChange?: (view: "list") => void;
}

export default function BookingCalendar({
  initialData,
  initialDate,
  onViewChange,
}: BookingCalendarProps) {
  const [data, setData] = useState<CalendarData>(initialData);
  const [date, setDate] = useState(initialDate);
  const [sportFilter, setSportFilter] = useState("");
  const [isPending, startTransition] = useTransition();

  // Modal state
  const [selectedBooking, setSelectedBooking] = useState<{
    booking: CellBooking;
    config: CalendarConfig;
    hour: number;
  } | null>(null);
  const [quickBookCell, setQuickBookCell] = useState<{
    config: CalendarConfig;
    hour: number;
  } | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const currentHourRef = useRef<HTMLTableRowElement>(null);

  // Auto-scroll to current hour on mount
  useEffect(() => {
    if (currentHourRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const row = currentHourRef.current;
      const containerRect = container.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const offset = rowRect.top - containerRect.top - containerRect.height / 3;
      container.scrollTop += offset;
    }
  }, []);

  // Fetch data on date/sport change
  const fetchData = useCallback(
    (newDate: string, newSport: string) => {
      startTransition(async () => {
        const result = await getCalendarData(
          newDate,
          newSport || undefined
        );
        setData(result);
      });
    },
    []
  );

  const handleDateChange = (newDate: string) => {
    setDate(newDate);
    fetchData(newDate, sportFilter);
  };

  const handleSportChange = (sport: string) => {
    setSportFilter(sport);
    fetchData(date, sport);
  };

  const handleToday = () => {
    const today = toDateStr(new Date());
    setDate(today);
    fetchData(today, sportFilter);
  };

  const currentHour = getCurrentHour();
  const { configs, grid, hours } = data;

  return (
    <div className="space-y-4">
      {/* ---- Top Controls ---- */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Date Slider */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleDateChange(shiftDate(date, -1))}
            className="rounded-lg border border-zinc-700 bg-zinc-800 p-1.5 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="min-w-[180px] text-center text-sm font-semibold text-white">
            {formatDateDisplay(date)}
          </div>
          <button
            onClick={() => handleDateChange(shiftDate(date, 1))}
            className="rounded-lg border border-zinc-700 bg-zinc-800 p-1.5 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-white"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {!isToday(date) && (
            <button
              onClick={handleToday}
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-white"
            >
              Today
            </button>
          )}
          {isPending && (
            <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Sport Filter */}
          <div className="flex items-center gap-1.5">
            {SPORT_FILTERS.map((sf) => (
              <button
                key={sf.value}
                onClick={() => handleSportChange(sf.value)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  sportFilter === sf.value
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                    : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700 hover:text-zinc-300"
                }`}
              >
                {sf.value && (
                  <span
                    className="mr-1.5 inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: SPORT_COLORS[sf.value] }}
                  />
                )}
                {sf.label}
              </button>
            ))}
          </div>

          {/* View Toggle */}
          <div className="flex items-center rounded-lg border border-zinc-700 bg-zinc-800 p-0.5">
            <button className="flex items-center gap-1.5 rounded-md bg-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-400">
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

      {/* ---- Calendar Grid ---- */}
      <div
        ref={scrollContainerRef}
        className="relative overflow-auto rounded-xl border border-zinc-800 bg-zinc-950"
        style={{ maxHeight: "calc(100vh - 220px)" }}
      >
        {/* Loading overlay */}
        {isPending && (
          <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-zinc-950/50 backdrop-blur-[1px]">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
          </div>
        )}

        <table className="w-full border-collapse">
          {/* Sticky header */}
          <thead>
            <tr className="sticky top-0 z-20">
              {/* Time column header */}
              <th className="sticky left-0 z-30 min-w-[80px] border-b border-r border-zinc-800 bg-zinc-900 px-3 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                Time
              </th>
              {/* Court config headers */}
              {configs.map((config) => {
                const sportColor = SPORT_COLORS[config.sport] || "#6b7280";
                return (
                  <th
                    key={config.id}
                    className="min-w-[140px] border-b border-r border-zinc-800 bg-zinc-900 px-3 py-3 text-center last:border-r-0"
                  >
                    <div className="flex flex-col items-center gap-1">
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                        style={{
                          backgroundColor: `${sportColor}15`,
                          color: sportColor,
                        }}
                      >
                        {SPORT_LABELS[config.sport] || config.sport}
                      </span>
                      <span className="text-xs font-medium text-zinc-300 whitespace-nowrap">
                        {config.label}
                      </span>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {hours.map((hour) => {
              const isCurrentHour = isToday(date) && hour === currentHour;
              return (
                <tr
                  key={hour}
                  ref={isCurrentHour ? currentHourRef : undefined}
                  className={`group/row transition-colors ${
                    isCurrentHour
                      ? "bg-emerald-500/[0.04]"
                      : "hover:bg-zinc-900/50"
                  }`}
                >
                  {/* Time label */}
                  <td
                    className={`sticky left-0 z-10 border-b border-r border-zinc-800 px-3 py-0 text-right align-top ${
                      isCurrentHour ? "bg-emerald-500/[0.06]" : "bg-zinc-950"
                    }`}
                    style={{ minHeight: 48 }}
                  >
                    <span
                      className={`text-[11px] font-medium leading-none ${
                        isCurrentHour ? "text-emerald-400" : "text-zinc-500"
                      }`}
                    >
                      {formatHourCompact(hour)}
                    </span>
                    {isCurrentHour && (
                      <div className="mt-0.5">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      </div>
                    )}
                  </td>

                  {/* Grid cells */}
                  {configs.map((config) => {
                    const cell = grid[config.id]?.[hour];
                    return (
                      <td
                        key={config.id}
                        className="relative border-b border-r border-zinc-800 p-0 last:border-r-0"
                        style={{ minHeight: 48, height: 48 }}
                      >
                        <CalendarCell
                          cell={cell}
                          config={config}
                          hour={hour}
                          date={date}
                          isCurrentHour={isCurrentHour}
                          onBookingClick={(booking) =>
                            setSelectedBooking({ booking, config, hour })
                          }
                          onEmptyClick={() =>
                            setQuickBookCell({ config, hour })
                          }
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Empty state */}
        {configs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
            <CalendarDays className="h-10 w-10 mb-3 text-zinc-600" />
            <p className="text-sm">No court configurations found</p>
            <p className="text-xs text-zinc-600 mt-1">
              Try a different sport filter
            </p>
          </div>
        )}
      </div>

      {/* ---- Booking Detail Modal ---- */}
      {selectedBooking && (
        <BookingDetailModal
          booking={selectedBooking.booking}
          config={selectedBooking.config}
          date={date}
          onClose={() => setSelectedBooking(null)}
        />
      )}

      {/* ---- Quick Book Modal ---- */}
      {quickBookCell && (
        <QuickBookModal
          config={quickBookCell.config}
          hour={quickBookCell.hour}
          date={date}
          onClose={() => setQuickBookCell(null)}
        />
      )}
    </div>
  );
}

// --------------- CalendarCell ---------------

function CalendarCell({
  cell,
  config,
  hour,
  date,
  isCurrentHour,
  onBookingClick,
  onEmptyClick,
}: {
  cell?: { booking?: CellBooking; blocked?: boolean; blockReason?: string };
  config: CalendarConfig;
  hour: number;
  date: string;
  isCurrentHour: boolean;
  onBookingClick: (booking: CellBooking) => void;
  onEmptyClick: () => void;
}) {
  // Blocked cell
  if (cell?.blocked) {
    return (
      <div
        className="flex h-12 items-center px-2"
        style={{
          background:
            "repeating-linear-gradient(-45deg, transparent, transparent 4px, rgba(113,113,122,0.1) 4px, rgba(113,113,122,0.1) 8px)",
        }}
      >
        <span className="truncate text-[10px] font-medium text-zinc-600">
          {cell.blockReason || "Blocked"}
        </span>
      </div>
    );
  }

  // Booked cell
  if (cell?.booking) {
    const isConfirmed = cell.booking.status === "CONFIRMED";
    const accentColor = isConfirmed ? "#10b981" : "#f59e0b";
    const firstName = cell.booking.userName.split(" ")[0];

    return (
      <button
        onClick={() => onBookingClick(cell.booking!)}
        className="group/cell flex h-12 w-full items-center gap-1.5 border-l-[3px] px-2 text-left transition-all hover:brightness-125"
        style={{
          borderLeftColor: accentColor,
          backgroundColor: `${accentColor}10`,
        }}
      >
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-xs font-medium"
            style={{ color: accentColor }}
          >
            {isConfirmed ? firstName : "Locked"}
          </p>
          {isConfirmed && cell.booking.paymentStatus && (
            <p className="truncate text-[10px] text-zinc-500">
              {formatPrice(cell.booking.totalAmount)}
            </p>
          )}
        </div>
      </button>
    );
  }

  // Empty / available cell
  return (
    <button
      onClick={onEmptyClick}
      className="group/cell flex h-12 w-full items-center justify-center transition-colors hover:bg-zinc-800/50"
    >
      <Plus className="h-3.5 w-3.5 text-zinc-700 opacity-0 transition-opacity group-hover/cell:opacity-100" />
    </button>
  );
}

// --------------- BookingDetailModal ---------------

function BookingDetailModal({
  booking,
  config,
  date,
  onClose,
}: {
  booking: CellBooking;
  config: CalendarConfig;
  date: string;
  onClose: () => void;
}) {
  const sportColor = SPORT_COLORS[config.sport] || "#6b7280";
  const isConfirmed = booking.status === "CONFIRMED";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Modal */}
      <div className="relative w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h3 className="text-base font-semibold text-white">
            Booking Details
          </h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-5 py-4">
          {/* Status row */}
          <div className="flex items-center gap-3">
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
              style={{
                backgroundColor: isConfirmed
                  ? "rgba(16,185,129,0.1)"
                  : "rgba(245,158,11,0.1)",
                borderColor: isConfirmed
                  ? "rgba(16,185,129,0.3)"
                  : "rgba(245,158,11,0.3)",
                color: isConfirmed ? "#10b981" : "#f59e0b",
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  backgroundColor: isConfirmed ? "#10b981" : "#f59e0b",
                }}
              />
              {isConfirmed ? "Confirmed" : "Locked"}
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
                  ` \u00B7 ${booking.paymentMethod.replace("_", " ")}`}
              </span>
            )}
          </div>

          {/* Customer */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 space-y-1.5">
            <p className="text-sm font-medium text-white">
              {booking.userName}
            </p>
            {booking.userEmail && (
              <p className="text-xs text-zinc-400">{booking.userEmail}</p>
            )}
            {booking.userPhone && (
              <p className="text-xs text-zinc-400">{booking.userPhone}</p>
            )}
          </div>

          {/* Booking Info */}
          <div className="grid grid-cols-2 gap-3">
            <InfoBlock label="Sport">
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: sportColor }}
                />
                {SPORT_LABELS[config.sport]}
              </span>
            </InfoBlock>
            <InfoBlock label="Court">{config.label}</InfoBlock>
            <InfoBlock label="Date">{formatDateDisplay(date)}</InfoBlock>
            <InfoBlock label="Time">
              {formatHoursAsRanges(booking.slots)}
            </InfoBlock>
            <InfoBlock label="Amount">
              <span className="text-emerald-400 font-semibold">
                {formatPrice(booking.totalAmount)}
              </span>
            </InfoBlock>
            <InfoBlock label="Booking ID">
              <span className="font-mono text-[10px]">
                {booking.id.slice(0, 8)}...
              </span>
            </InfoBlock>
          </div>
        </div>

        {/* Footer */}
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
  config,
  hour,
  date,
  onClose,
}: {
  config: CalendarConfig;
  hour: number;
  date: string;
  onClose: () => void;
}) {
  const sportColor = SPORT_COLORS[config.sport] || "#6b7280";

  const createUrl = `/admin/bookings/create?courtConfigId=${config.id}&date=${date}&hour=${hour}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Modal */}
      <div className="relative w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h3 className="text-base font-semibold text-white">
            Quick Book
          </h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-3 px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <InfoBlock label="Sport">
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: sportColor }}
                />
                {SPORT_LABELS[config.sport]}
              </span>
            </InfoBlock>
            <InfoBlock label="Court">{config.label}</InfoBlock>
            <InfoBlock label="Date">{formatDateDisplay(date)}</InfoBlock>
            <InfoBlock label="Time">{formatHourRangeCompact(hour)}</InfoBlock>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-800 px-5 py-4">
          <Link
            href={createUrl}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" />
            Create Booking
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
      <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 mb-0.5">
        {label}
      </p>
      <p className="text-xs text-zinc-200">{children}</p>
    </div>
  );
}
