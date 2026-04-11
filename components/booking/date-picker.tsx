"use client";

import { useRef } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { getUpcomingDatesIST, formatDateIST, getTodayIST } from "@/lib/ist-date";

interface DatePickerProps {
  selectedDate: string;
  onDateChange: (date: string) => void;
}

export function DatePicker({ selectedDate, onDateChange }: DatePickerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Generate next 30 days in IST
  const dateStrings = getUpcomingDatesIST(30);

  const scroll = (direction: "left" | "right") => {
    if (!scrollRef.current) return;
    const amount = 300;
    scrollRef.current.scrollBy({
      left: direction === "left" ? -amount : amount,
      behavior: "smooth",
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-zinc-400">
        <CalendarDays className="h-4 w-4" />
        <span>Select Date</span>
      </div>
      <div className="relative group">
        {/* Left arrow */}
        <button
          onClick={() => scroll("left")}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 h-10 w-8 flex items-center justify-center bg-gradient-to-r from-black/80 to-transparent rounded-l-xl opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <ChevronLeft className="h-5 w-5 text-zinc-300" />
        </button>

        {/* Scrollable dates */}
        <div
          ref={scrollRef}
          className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide scroll-smooth"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {dateStrings.map((dateStr) => {
            const info = formatDateIST(dateStr);
            const isSelected = selectedDate === dateStr;

            return (
              <button
                key={dateStr}
                onClick={() => onDateChange(dateStr)}
                className={`flex min-w-[70px] flex-shrink-0 flex-col items-center rounded-xl border p-3 transition-all duration-200 ${
                  isSelected
                    ? "border-emerald-400 bg-emerald-500/20 ring-1 ring-emerald-400/50"
                    : "border-zinc-800 bg-zinc-900 hover:border-zinc-600"
                }`}
              >
                <span
                  className={`text-xs font-medium ${
                    isSelected
                      ? "text-emerald-400"
                      : info.isWeekend
                      ? "text-yellow-400"
                      : "text-zinc-500"
                  }`}
                >
                  {info.dayName}
                </span>
                <span
                  className={`text-xl font-bold ${
                    isSelected ? "text-white" : "text-zinc-300"
                  }`}
                >
                  {info.date}
                </span>
                <span className="text-xs text-zinc-500">
                  {info.month}
                </span>
                {info.isToday && (
                  <span className="mt-1 text-[10px] font-medium text-emerald-500">
                    Today
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Right arrow */}
        <button
          onClick={() => scroll("right")}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 h-10 w-8 flex items-center justify-center bg-gradient-to-l from-black/80 to-transparent rounded-r-xl opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <ChevronRight className="h-5 w-5 text-zinc-300" />
        </button>
      </div>
    </div>
  );
}
