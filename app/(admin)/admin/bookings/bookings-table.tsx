"use client";

import { useState } from "react";
import Link from "next/link";
import { formatHoursAsRanges } from "@/lib/court-config";
import {
  CheckCircle2,
  Clock,
  XCircle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  CreditCard,
  QrCode,
  Banknote,
  Smartphone,
  Repeat,
  User,
} from "lucide-react";

interface BookingSlot {
  startHour: number;
  price: number;
}

interface BookingPayment {
  status: string;
  method: string;
  amount: number;
  isPartialPayment?: boolean;
  advanceAmount?: number | null;
  remainingAmount?: number | null;
}

interface BookingData {
  id: string;
  date: string | Date;
  status: "CONFIRMED" | "PENDING" | "CANCELLED";
  totalAmount: number;
  createdAt: string | Date;
  createdByAdminId?: string | null;
  recurringBookingId?: string | null;
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
  };
  courtConfig: {
    sport: string;
    label: string;
    size: string;
  };
  slots: BookingSlot[];
  payment?: BookingPayment | null;
  _isRecurringChildPayment: boolean;
  recurringBooking?: {
    id: string;
    mode: string;
    status: string;
    dayOfWeek: number;
    startHour: number;
    endHour: number;
  } | null;
}

interface BookingsTableProps {
  bookings: BookingData[];
  sportInfo: Record<string, { name: string; icon: string }>;
}

const STATUS_CONFIG = {
  CONFIRMED: {
    icon: CheckCircle2,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
    label: "Confirmed",
    dot: "bg-emerald-400",
  },
  PENDING: {
    icon: Clock,
    color: "text-yellow-400",
    bg: "bg-yellow-500/10",
    border: "border-yellow-500/20",
    label: "Pending",
    dot: "bg-yellow-400",
  },
  CANCELLED: {
    icon: XCircle,
    color: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/20",
    label: "Cancelled",
    dot: "bg-red-400",
  },
};

const PAYMENT_ICONS: Record<string, typeof CreditCard> = {
  RAZORPAY: CreditCard,
  PHONEPE: Smartphone,
  UPI_QR: QrCode,
  CASH: Banknote,
};

const PAYMENT_STATUS_STYLES: Record<string, string> = {
  PENDING: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
  PARTIAL: "text-amber-300 bg-amber-500/10 border-amber-500/40",
  COMPLETED: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  REFUNDED: "text-blue-400 bg-blue-500/10 border-blue-500/30",
  FAILED: "text-red-400 bg-red-500/10 border-red-500/30",
};

function formatPrice(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
  });
}

function formatDateTime(date: string | Date): { date: string; time: string } {
  const d = new Date(date);
  return {
    date: d.toLocaleDateString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
    }),
    time: d.toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

// Sport emoji mapping
const SPORT_EMOJI: Record<string, string> = {
  CRICKET: "🏏",
  FOOTBALL: "⚽",
  PICKLEBALL: "🏓",
};

interface GroupedBookings {
  type: "single" | "series";
  seriesId?: string;
  seriesMode?: string;
  seriesCount?: number;
  bookings: BookingData[];
}

function groupBookings(bookings: BookingData[]): GroupedBookings[] {
  const groups: GroupedBookings[] = [];
  const seriesMap = new Map<string, BookingData[]>();
  const singles: BookingData[] = [];

  for (const b of bookings) {
    if (b.recurringBookingId) {
      const existing = seriesMap.get(b.recurringBookingId);
      if (existing) {
        existing.push(b);
      } else {
        seriesMap.set(b.recurringBookingId, [b]);
      }
    } else {
      singles.push(b);
    }
  }

  // Interleave in order of first appearance
  const seen = new Set<string>();
  for (const b of bookings) {
    if (b.recurringBookingId) {
      if (!seen.has(b.recurringBookingId)) {
        seen.add(b.recurringBookingId);
        const seriesBookings = seriesMap.get(b.recurringBookingId)!;
        groups.push({
          type: "series",
          seriesId: b.recurringBookingId,
          seriesMode: b.recurringBooking?.mode || "weekly",
          seriesCount: seriesBookings.length,
          bookings: seriesBookings,
        });
      }
    } else {
      groups.push({ type: "single", bookings: [b] });
    }
  }

  return groups;
}

function BookingRow({ booking, isSeriesChild = false, sportInfo }: { booking: BookingData; isSeriesChild?: boolean; sportInfo: Record<string, { name: string }> }) {
  const status = STATUS_CONFIG[booking.status];
  const PayMethodIcon = booking.payment ? PAYMENT_ICONS[booking.payment.method] || CreditCard : null;
  const created = formatDateTime(booking.createdAt);
  const sport = sportInfo[booking.courtConfig.sport];

  return (
    <Link
      href={`/admin/bookings/${booking.id}`}
      className={`group grid grid-cols-[1fr_auto] md:grid-cols-[2fr_1.2fr_1fr_1fr_0.8fr_1fr_auto] gap-3 items-center px-4 py-3 transition-all hover:bg-zinc-800/60 ${
        isSeriesChild
          ? "ml-3 border-l-2 border-purple-500/20 pl-5"
          : ""
      }`}
    >
      {/* Customer + Sport (mobile: stacked, desktop: side by side) */}
      <div className="flex items-center gap-3 min-w-0">
        {/* Avatar */}
        <div className={`shrink-0 h-9 w-9 rounded-full flex items-center justify-center text-sm font-bold ${status.bg} ${status.color}`}>
          {booking.user.name
            ? booking.user.name.charAt(0).toUpperCase()
            : <User className="h-4 w-4" />
          }
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-white truncate">
              {booking.user.name || booking.user.phone || "—"}
            </span>
            {booking.createdByAdminId && (
              <span className="shrink-0 rounded border border-amber-500/30 bg-amber-500/10 px-1 py-px text-[9px] font-semibold text-amber-400 uppercase tracking-wide">
                Admin
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-zinc-500 mt-0.5">
            <span>{SPORT_EMOJI[booking.courtConfig.sport] || "🎯"}</span>
            <span>{sport?.name || booking.courtConfig.sport}</span>
            <span className="text-zinc-700">·</span>
            <span className="text-zinc-600">{booking.courtConfig.label}</span>
          </div>
        </div>
      </div>

      {/* Date + Slots */}
      <div className="hidden md:block">
        <p className="text-sm text-zinc-200">
          {formatDate(booking.date)}
        </p>
        <p className="text-xs text-zinc-500 font-mono mt-0.5">
          {formatHoursAsRanges(booking.slots.map((s) => s.startHour))}
        </p>
      </div>

      {/* Amount */}
      <div className="hidden md:block">
        <span className="text-sm font-semibold text-white">
          {formatPrice(booking.totalAmount)}
        </span>
      </div>

      {/* Status */}
      <div className="hidden md:block">
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${status.color}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
          {status.label}
        </span>
      </div>

      {/* Booked On */}
      <div className="hidden md:block">
        <p className="text-xs text-zinc-400">{created.date}</p>
        <p className="text-[10px] text-zinc-600">{created.time}</p>
      </div>

      {/* Payment */}
      <div className="hidden md:block">
        {booking.payment ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              {PayMethodIcon && <PayMethodIcon className="h-3.5 w-3.5 text-zinc-500" />}
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${PAYMENT_STATUS_STYLES[booking.payment.status]}`}>
                {booking.payment.status}
              </span>
              {booking._isRecurringChildPayment && (
                <span className="text-[9px] text-purple-400 font-medium">series</span>
              )}
            </div>
            {booking.payment.isPartialPayment && (booking.payment.remainingAmount ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300 w-fit">
                <Banknote className="h-3 w-3" />
                {/* Derive owed-at-venue from totalAmount - advance (post-discount)
                    instead of reading Payment.remainingAmount, which historically
                    stored the PRE-discount remainder and showed ₹X-too-high on
                    coupon bookings. Using Payment.remainingAmount only as the
                    "still owed?" boolean gate. */}
                Collect {formatPrice(Math.max(booking.totalAmount - (booking.payment.advanceAmount ?? 0), 0))} at venue
              </span>
            )}
          </div>
        ) : (
          <span className="text-xs text-zinc-700">—</span>
        )}
      </div>

      {/* Mobile: right side summary + Arrow */}
      <div className="flex items-center gap-2 md:justify-end">
        <div className="md:hidden text-right">
          <p className="text-sm font-semibold text-white">{formatPrice(booking.totalAmount)}</p>
          <div className="flex items-center gap-1 justify-end mt-0.5">
            <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
            <span className={`text-[10px] ${status.color}`}>{status.label}</span>
          </div>
          {booking.payment?.isPartialPayment && (booking.payment.remainingAmount ?? 0) > 0 && (
            <p className="mt-0.5 text-[10px] font-semibold text-amber-300">
              {formatPrice(Math.max(booking.totalAmount - (booking.payment.advanceAmount ?? 0), 0))} at venue
            </p>
          )}
        </div>
        <ExternalLink className="h-3.5 w-3.5 text-zinc-700 group-hover:text-emerald-400 transition-colors shrink-0" />
      </div>
    </Link>
  );
}

function SeriesGroup({ group, sportInfo }: { group: GroupedBookings; sportInfo: Record<string, { name: string }> }) {
  const [expanded, setExpanded] = useState(false);
  const first = group.bookings[0];
  const sport = sportInfo[first.courtConfig.sport];
  const totalAmount = group.bookings.reduce((sum, b) => sum + b.totalAmount, 0);
  const confirmedCount = group.bookings.filter((b) => b.status === "CONFIRMED").length;
  const modeLabel = group.seriesMode === "daily" ? "Daily" : "Weekly";

  // Payment from first booking
  const payment = group.bookings.find((b) => b.payment)?.payment;

  return (
    <div className="border-b border-zinc-800/50 last:border-b-0">
      {/* Series Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full grid grid-cols-[1fr_auto] md:grid-cols-[2fr_1.2fr_1fr_1fr_0.8fr_1fr_auto] gap-3 items-center px-4 py-3 hover:bg-purple-500/5 transition-all"
      >
        {/* Series Info */}
        <div className="flex items-center gap-3">
          <div className="shrink-0 h-9 w-9 rounded-full bg-purple-500/15 flex items-center justify-center">
            <Repeat className="h-4 w-4 text-purple-400" />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-purple-300">
                {modeLabel} Series
              </span>
              <span className="rounded border border-purple-500/30 bg-purple-500/10 px-1.5 py-px text-[10px] font-semibold text-purple-400">
                {group.seriesCount} bookings
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-zinc-500 mt-0.5">
              <span>{SPORT_EMOJI[first.courtConfig.sport] || "🎯"}</span>
              <span>{sport?.name}</span>
              <span className="text-zinc-700">·</span>
              <span>{first.courtConfig.label}</span>
              <span className="text-zinc-700">·</span>
              <span>{first.user.name || first.user.phone}</span>
            </div>
          </div>
        </div>

        {/* Date range */}
        <div className="hidden md:block text-left">
          <p className="text-xs text-zinc-400">
            {formatDate(group.bookings[group.bookings.length - 1].date)} — {formatDate(group.bookings[0].date)}
          </p>
          <p className="text-[10px] text-zinc-600 mt-0.5">
            {confirmedCount}/{group.seriesCount} confirmed
          </p>
        </div>

        {/* Total amount */}
        <div className="hidden md:block text-left">
          <span className="text-sm font-semibold text-purple-300">
            {formatPrice(totalAmount)}
          </span>
          <p className="text-[10px] text-zinc-600">total series</p>
        </div>

        {/* Status summary */}
        <div className="hidden md:block">
          {confirmedCount === group.seriesCount ? (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              All Confirmed
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-yellow-400">
              <span className="h-1.5 w-1.5 rounded-full bg-yellow-400" />
              Partial
            </span>
          )}
        </div>

        {/* Booked On (series) */}
        <div className="hidden md:block">
          <p className="text-xs text-zinc-500">
            {formatDateTime(first.createdAt).date}
          </p>
        </div>

        {/* Payment */}
        <div className="hidden md:block">
          {payment ? (
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${PAYMENT_STATUS_STYLES[payment.status]}`}>
              {payment.status} · {payment.method.replace("_", " ")}
            </span>
          ) : (
            <span className="text-xs text-zinc-700">—</span>
          )}
        </div>

        {/* Toggle */}
        <div className="flex items-center gap-2">
          <div className="md:hidden text-right">
            <p className="text-sm font-semibold text-purple-300">{formatPrice(totalAmount)}</p>
          </div>
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-purple-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-zinc-600" />
          )}
        </div>
      </button>

      {/* Expanded children */}
      {expanded && (
        <div className="bg-zinc-950/50">
          {group.bookings.map((b) => (
            <BookingRow key={b.id} booking={b} isSeriesChild sportInfo={sportInfo} />
          ))}
        </div>
      )}
    </div>
  );
}

export function BookingsTable({ bookings, sportInfo }: BookingsTableProps) {
  const groups = groupBookings(bookings);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 overflow-hidden">
      {/* Table header — desktop only */}
      <div className="hidden md:grid grid-cols-[2fr_1.2fr_1fr_1fr_0.8fr_1fr_auto] gap-3 px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/80">
        <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Customer</span>
        <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Date / Slots</span>
        <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Amount</span>
        <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Status</span>
        <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Booked On</span>
        <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Payment</span>
        <span className="w-4" />
      </div>

      {/* Rows */}
      <div className="divide-y divide-zinc-800/40">
        {groups.map((group, i) => {
          if (group.type === "series" && group.bookings.length > 1) {
            return <SeriesGroup key={group.seriesId || i} group={group} sportInfo={sportInfo} />;
          }
          return (
            <BookingRow
              key={group.bookings[0].id}
              booking={group.bookings[0]}
              sportInfo={sportInfo}
            />
          );
        })}
      </div>
    </div>
  );
}
