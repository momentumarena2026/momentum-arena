/**
 * IST (Asia/Kolkata) timezone helpers — port of web's lib/ist-date.ts.
 *
 * All booking logic must use IST, not the device UTC time, because the venue
 * operates in Indian Standard Time (UTC+5:30). Keeping the function shapes
 * identical to the web means the mobile date-picker renders the same 30-day
 * strip with the same "Today"/weekend/weekday treatment.
 */

const IST_TZ = "Asia/Kolkata";

/** Get the current date string in IST as "YYYY-MM-DD". */
export function getTodayIST(): string {
  // "en-CA" formats dates as YYYY-MM-DD regardless of device locale.
  return new Date().toLocaleDateString("en-CA", { timeZone: IST_TZ });
}

/** Get the current hour (0-23) in IST. */
export function getCurrentHourIST(): number {
  return parseInt(
    new Date().toLocaleString("en-US", {
      timeZone: IST_TZ,
      hour: "numeric",
      hour12: false,
    }),
    10
  );
}

/**
 * Generate an array of "YYYY-MM-DD" date strings starting from today in IST.
 * Powers the horizontally-scrollable date picker.
 */
export function getUpcomingDatesIST(count: number): string[] {
  const dates: string[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getTime() + i * 86400000);
    dates.push(d.toLocaleDateString("en-CA", { timeZone: IST_TZ }));
  }
  return dates;
}

/**
 * Format a "YYYY-MM-DD" string into display parts in IST.
 * Mirrors web's formatDateIST exactly.
 */
export function formatDateIST(dateStr: string): {
  dayName: string;
  date: number;
  month: string;
  isWeekend: boolean;
  isToday: boolean;
  value: string;
} {
  // Parse as local noon to avoid timezone-boundary date-shift.
  const d = new Date(dateStr + "T12:00:00");

  const day = d.toLocaleDateString("en-US", {
    timeZone: IST_TZ,
    weekday: "short",
  });
  const dateNum = parseInt(
    d.toLocaleDateString("en-US", { timeZone: IST_TZ, day: "numeric" }),
    10
  );
  const monthStr = d.toLocaleDateString("en-US", {
    timeZone: IST_TZ,
    month: "short",
  });
  const weekday = d.toLocaleDateString("en-US", {
    timeZone: IST_TZ,
    weekday: "long",
  });

  const isWeekend = weekday === "Sunday" || weekday === "Saturday";

  return {
    dayName: day,
    date: dateNum,
    month: monthStr,
    isWeekend,
    isToday: dateStr === getTodayIST(),
    value: dateStr,
  };
}
