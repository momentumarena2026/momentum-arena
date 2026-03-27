"use client";

import { useState } from "react";
import BookingCalendar from "./booking-calendar";
import type { CalendarData } from "@/actions/admin-calendar";

interface BookingsPageWrapperProps {
  calendarData: CalendarData;
  calendarDate: string;
  listViewContent: React.ReactNode;
}

export function BookingsPageWrapper({
  calendarData,
  calendarDate,
  listViewContent,
}: BookingsPageWrapperProps) {
  const [view, setView] = useState<"calendar" | "list">("calendar");

  if (view === "calendar") {
    return (
      <BookingCalendar
        initialData={calendarData}
        initialDate={calendarDate}
        onViewChange={() => setView("list")}
      />
    );
  }

  return (
    <div>
      {/* View toggle at the top of list view */}
      <div className="flex items-center justify-end mb-4">
        <div className="flex rounded-lg border border-zinc-700 overflow-hidden">
          <button
            onClick={() => setView("calendar")}
            className="px-3 py-1.5 text-xs font-medium bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors"
          >
            📅 Calendar
          </button>
          <button
            className="px-3 py-1.5 text-xs font-medium bg-emerald-500/20 text-emerald-400 border-l border-zinc-700"
          >
            📋 List
          </button>
        </div>
      </div>
      {listViewContent}
    </div>
  );
}
