"use client";

import { CalendarDays } from "lucide-react";

interface CalendarExportProps {
  bookingId: string;
  bookingDate: Date;
  startHour: number;
  endHour: number;
  sport: string;
  courtLabel: string;
  totalAmount: number;
}

function buildStartEnd(date: Date, hour: number): Date {
  const d = new Date(date);
  const actualHour = hour % 24;
  d.setUTCHours(actualHour - 5, 30, 0, 0); // IST offset: UTC+5:30
  return d;
}

function formatGCalDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    "T" +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds())
  );
}

const ARENA_LOCATION =
  "Momentum Arena, Khasra no. 293/5, Radhapuram Road, Mathura, UP 281004";

export function CalendarExport({
  bookingId,
  bookingDate,
  startHour,
  endHour,
  sport,
  courtLabel,
  totalAmount,
}: CalendarExportProps) {
  const title = `${sport} Booking - Momentum Arena`;
  const amountStr = `₹${(totalAmount / 100).toLocaleString("en-IN")}`;
  const description = `Court: ${courtLabel}\nBooking ID: ${bookingId}\nAmount: ${amountStr}`;

  const startDT = buildStartEnd(bookingDate, startHour);
  const endDT = buildStartEnd(bookingDate, endHour);

  function handleGoogleCalendar() {
    const start = formatGCalDate(startDT);
    const end = formatGCalDate(endDT);
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: title,
      dates: `${start}/${end}`,
      details: description,
      location: ARENA_LOCATION,
    });
    window.open(
      `https://calendar.google.com/calendar/render?${params.toString()}`,
      "_blank",
      "noopener,noreferrer"
    );
  }

  return (
    <button
      onClick={handleGoogleCalendar}
      className="flex items-center gap-2 rounded-xl border border-zinc-700 px-4 py-3 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white w-full justify-center"
    >
      <CalendarDays className="h-4 w-4" />
      Add to Google Calendar
    </button>
  );
}
