"use client";

import { CalendarDays } from "lucide-react";

interface DatePickerProps {
  selectedDate: string;
  onDateChange: (date: string) => void;
}

export function DatePicker({ selectedDate, onDateChange }: DatePickerProps) {
  // Generate next 7 days
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return d;
  });

  const formatDateValue = (d: Date) => d.toISOString().split("T")[0];

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-zinc-400">
        <CalendarDays className="h-4 w-4" />
        <span>Select Date</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {dates.map((date) => {
          const value = formatDateValue(date);
          const isSelected = selectedDate === value;
          const isToday = formatDateValue(new Date()) === value;
          const isWeekend = date.getDay() === 0 || date.getDay() === 6;

          return (
            <button
              key={value}
              onClick={() => onDateChange(value)}
              className={`flex min-w-[70px] flex-col items-center rounded-xl border p-3 transition-all duration-200 ${
                isSelected
                  ? "border-emerald-400 bg-emerald-500/20 ring-1 ring-emerald-400/50"
                  : "border-zinc-800 bg-zinc-900 hover:border-zinc-600"
              }`}
            >
              <span
                className={`text-xs font-medium ${
                  isSelected
                    ? "text-emerald-400"
                    : isWeekend
                    ? "text-yellow-400"
                    : "text-zinc-500"
                }`}
              >
                {dayNames[date.getDay()]}
              </span>
              <span
                className={`text-xl font-bold ${
                  isSelected ? "text-white" : "text-zinc-300"
                }`}
              >
                {date.getDate()}
              </span>
              <span className="text-xs text-zinc-500">
                {monthNames[date.getMonth()]}
              </span>
              {isToday && (
                <span className="mt-1 text-[10px] font-medium text-emerald-500">
                  Today
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
