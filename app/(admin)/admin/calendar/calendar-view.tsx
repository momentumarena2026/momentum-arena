"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  X,
  ExternalLink,
  Loader2,
} from "lucide-react";
import {
  getCalendarData,
  type CalendarData,
  type CellBooking,
} from "@/actions/admin-calendar";
import { formatHourCompact, formatHoursAsRanges } from "@/lib/court-config";
import { getTodayIST } from "@/lib/ist-date";
import type { Sport } from "@prisma/client";

const SPORT_CHIPS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "CRICKET", label: "Cricket" },
  { value: "FOOTBALL", label: "Football" },
  { value: "PICKLEBALL", label: "Pickleball" },
  { value: "BADMINTON", label: "Badminton" },
];

function formatPrice(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

interface CalendarViewProps {
  initialDate: string;
  initialData: CalendarData;
}

export function CalendarView({ initialDate, initialData }: CalendarViewProps) {
  const [date, setDate] = useState(initialDate);
  const [sportFilter, setSportFilter] = useState("");
  const [data, setData] = useState<CalendarData>(initialData);
  const [isPending, startTransition] = useTransition();
  const [selectedBooking, setSelectedBooking] = useState<{
    booking: CellBooking;
    configLabel: string;
  } | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasAutoScrolled = useRef(false);

  // Fetch data when date or sport filter changes
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

  // Auto-scroll to current hour on mount
  useEffect(() => {
    if (hasAutoScrolled.current) return;
    hasAutoScrolled.current = true;

    const container = scrollContainerRef.current;
    if (!container) return;

    const currentHour = new Date().getHours();
    // Each row is roughly 48px (h-12), scroll to put current hour near top
    const rowIndex = Math.max(0, currentHour - 5); // hours start at 5
    const scrollTarget = rowIndex * 48 - 100;
    container.scrollTop = Math.max(0, scrollTarget);
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

  // Format date for display
  const displayDate = new Date(date + "T00:00:00").toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-4">
      {/* Top bar: Date navigation + sport filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Date controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigateDay(-1)}
            className="rounded-lg border border-zinc-700 bg-zinc-800 p-2 text-zinc-400 hover:bg-zinc-700 hover:text-white transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <input
            type="date"
            value={date}
            onChange={(e) => handleDateChange(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <button
            onClick={() => navigateDay(1)}
            className="rounded-lg border border-zinc-700 bg-zinc-800 p-2 text-zinc-400 hover:bg-zinc-700 hover:text-white transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => handleDateChange(getTodayIST())}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-400 hover:bg-zinc-700 hover:text-white transition-colors"
          >
            Today
          </button>
          {isPending && (
            <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
          )}
        </div>

        {/* Sport filter chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {SPORT_CHIPS.map((chip) => (
            <button
              key={chip.value}
              onClick={() => handleSportChange(chip.value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                sportFilter === chip.value
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {/* Date display */}
      <p className="text-sm text-zinc-500">{displayDate}</p>

      {/* Calendar grid */}
      {data.configs.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-12 text-center">
          <p className="text-zinc-400">
            No court configurations found
            {sportFilter ? " for this sport" : ""}
          </p>
        </div>
      ) : (
        <div
          ref={scrollContainerRef}
          className="relative overflow-auto rounded-xl border border-zinc-800 bg-zinc-900"
          style={{ maxHeight: "calc(100vh - 280px)" }}
        >
          <table className="w-full border-collapse">
            {/* Header row: config labels */}
            <thead className="sticky top-0 z-20">
              <tr>
                <th className="sticky left-0 z-30 min-w-[80px] border-b border-r border-zinc-700 bg-zinc-900 px-3 py-3 text-left text-xs font-medium text-zinc-500">
                  Time
                </th>
                {data.configs.map((config) => (
                  <th
                    key={config.id}
                    className="min-w-[140px] border-b border-r border-zinc-700 bg-zinc-900 px-2 py-3 text-center text-xs font-medium text-zinc-400"
                  >
                    <div className="truncate">{config.label}</div>
                    <div className="mt-0.5 text-[10px] text-zinc-600">
                      {config.sport}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.hours.map((hour) => {
                const now = new Date();
                const isCurrentHour =
                  date === now.toISOString().split("T")[0] &&
                  hour === now.getHours();

                return (
                  <tr
                    key={hour}
                    className={
                      isCurrentHour
                        ? "bg-emerald-500/5"
                        : "hover:bg-zinc-800/30"
                    }
                  >
                    {/* Hour label — sticky left */}
                    <td
                      className={`sticky left-0 z-10 border-b border-r border-zinc-800 px-3 py-0 text-xs font-medium whitespace-nowrap ${
                        isCurrentHour
                          ? "bg-emerald-500/10 text-emerald-400"
                          : "bg-zinc-900 text-zinc-500"
                      }`}
                    >
                      {formatHourCompact(hour)}
                    </td>

                    {/* Config columns */}
                    {data.configs.map((config) => {
                      const cell = data.grid[config.id]?.[hour];

                      return (
                        <td
                          key={config.id}
                          className="border-b border-r border-zinc-800 p-1"
                        >
                          <CalendarCell
                            cell={cell}
                            configId={config.id}
                            configLabel={config.label}
                            date={date}
                            hour={hour}
                            onSelectBooking={(booking) =>
                              setSelectedBooking({
                                booking,
                                configLabel: config.label,
                              })
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
        </div>
      )}

      {/* Booking detail modal */}
      {selectedBooking && (
        <BookingDetailModal
          booking={selectedBooking.booking}
          configLabel={selectedBooking.configLabel}
          onClose={() => setSelectedBooking(null)}
        />
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-zinc-500">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded border border-emerald-500/40 bg-emerald-500/20" />
          Confirmed
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded border border-yellow-500/40 bg-yellow-500/20" />
          Locked
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded border border-zinc-600 bg-zinc-700/30" />
          Blocked
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded border border-zinc-700 bg-zinc-900" />
          Available
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// CalendarCell
// --------------------------------------------------------------------------

interface CalendarCellProps {
  cell?: { booking?: CellBooking; blocked?: boolean; blockReason?: string };
  configId: string;
  configLabel: string;
  date: string;
  hour: number;
  onSelectBooking: (booking: CellBooking) => void;
}

function CalendarCell({
  cell,
  configId,
  date,
  hour,
  onSelectBooking,
}: CalendarCellProps) {
  // Booked cell
  if (cell?.booking) {
    const isConfirmed = cell.booking.status === "CONFIRMED";
    return (
      <button
        onClick={() => onSelectBooking(cell.booking!)}
        className={`group relative flex h-10 w-full items-center justify-center rounded-md border px-1 text-[11px] font-medium transition-all hover:brightness-125 ${
          isConfirmed
            ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-300"
            : "border-yellow-500/40 bg-yellow-500/20 text-yellow-300"
        }`}
      >
        <span className="truncate">
          {isConfirmed ? cell.booking.userName : "Locked"}
        </span>
      </button>
    );
  }

  // Blocked cell
  if (cell?.blocked) {
    return (
      <div
        className="flex h-10 w-full items-center justify-center rounded-md border border-zinc-600/30 bg-zinc-700/30 px-1 text-[11px] text-zinc-500"
        title={cell.blockReason || "Blocked"}
      >
        <span className="truncate">
          {cell.blockReason || "Blocked"}
        </span>
      </div>
    );
  }

  // Available cell
  return (
    <Link
      href={`/admin/bookings/create?courtConfigId=${configId}&date=${date}&hour=${hour}`}
      className="group flex h-10 w-full items-center justify-center rounded-md border border-transparent text-zinc-700 transition-all hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-400"
    >
      <Plus className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
    </Link>
  );
}

// --------------------------------------------------------------------------
// BookingDetailModal
// --------------------------------------------------------------------------

interface BookingDetailModalProps {
  booking: CellBooking;
  configLabel: string;
  onClose: () => void;
}

function BookingDetailModal({
  booking,
  configLabel,
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
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h3 className="text-sm font-semibold text-white">Booking Details</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-3 px-5 py-4">
          <DetailRow label="Booking ID" value={booking.id} mono />
          <DetailRow label="Customer" value={booking.userName} />
          {booking.userEmail && (
            <DetailRow label="Email" value={booking.userEmail} />
          )}
          {booking.userPhone && (
            <DetailRow label="Phone" value={booking.userPhone} />
          )}
          <DetailRow label="Court" value={configLabel} />
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
          <DetailRow
            label="Slots"
            value={formatHoursAsRanges(booking.slots)}
          />
          <DetailRow label="Amount" value={formatPrice(booking.totalAmount)} />
          {booking.paymentStatus && (
            <DetailRow
              label="Payment"
              value={`${booking.paymentStatus} (${booking.paymentMethod?.replace("_", " ")})`}
            />
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-800 px-5 py-3">
          <Link
            href={`/admin/bookings/${booking.id}`}
            className="flex items-center justify-center gap-2 rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View Full Booking
          </Link>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// DetailRow helper
// --------------------------------------------------------------------------

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
      <span className="text-xs text-zinc-500 shrink-0">{label}</span>
      <span
        className={`text-xs text-right text-zinc-200 ${mono ? "font-mono text-[10px]" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
