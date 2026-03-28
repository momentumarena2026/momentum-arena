"use client";

import { useState, useRef, useEffect } from "react";
import { CalendarDays, ChevronDown, Download, ExternalLink } from "lucide-react";
import { generateICS } from "@/lib/ics";

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
  // date is a Date object with the booking date; hour is 5-24
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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const title = `${sport} Booking - Momentum Arena`;
  const amountStr = `₹${(totalAmount / 100).toLocaleString("en-IN")}`;
  const description = `Court: ${courtLabel}\nBooking ID: ${bookingId}\nAmount: ${amountStr}`;

  const startDT = buildStartEnd(bookingDate, startHour);
  const endDT = buildStartEnd(bookingDate, endHour);

  function handleDownloadICS() {
    const ics = generateICS({
      title,
      description,
      location: ARENA_LOCATION,
      startDateTime: startDT,
      endDateTime: endDT,
      uid: bookingId,
    });
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `momentum-arena-${bookingId}.ics`;
    a.click();
    URL.revokeObjectURL(url);
    setOpen(false);
  }

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
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-xl border border-zinc-700 px-4 py-3 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white w-full justify-center"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <CalendarDays className="h-4 w-4" />
        Add to Calendar
        <ChevronDown
          className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute bottom-full mb-2 left-0 right-0 z-10 rounded-xl border border-zinc-700 bg-zinc-900 shadow-xl overflow-hidden">
          <button
            onClick={handleGoogleCalendar}
            className="flex w-full items-center gap-3 px-4 py-3 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            <ExternalLink className="h-4 w-4 text-blue-400" />
            Google Calendar
          </button>
          <div className="border-t border-zinc-800" />
          <button
            onClick={handleDownloadICS}
            className="flex w-full items-center gap-3 px-4 py-3 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            <Download className="h-4 w-4 text-emerald-400" />
            Download .ics (Apple / Outlook)
          </button>
        </div>
      )}
    </div>
  );
}
