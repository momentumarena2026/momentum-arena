/**
 * IST (Asia/Kolkata) timezone helpers.
 *
 * All booking logic must use IST, not the server/browser UTC time,
 * because the venue operates in Indian Standard Time (UTC+5:30).
 */

const IST_TZ = "Asia/Kolkata";

/** Get the current date string in IST as "YYYY-MM-DD" */
export function getTodayIST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: IST_TZ });
  // "en-CA" locale formats as YYYY-MM-DD
}

/** Get the current hour (0-23) in IST */
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
 * Generate an array of dates (as "YYYY-MM-DD" strings) starting from today in IST.
 * Useful for client-side date pickers.
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
 * Format a "YYYY-MM-DD" date string into display parts in IST.
 * Returns { dayName, date, month, isWeekend, isToday, value }.
 */
export function formatDateIST(dateStr: string): {
  dayName: string;
  date: number;
  month: string;
  isWeekend: boolean;
  isToday: boolean;
  value: string;
} {
  // Parse as local noon to avoid any timezone date-shift
  const d = new Date(dateStr + "T12:00:00");
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  const dayIndex = parseInt(
    d.toLocaleDateString("en-US", { timeZone: IST_TZ, weekday: "narrow" }),
    10
  );

  // Use IST-aware formatting
  const day = d.toLocaleDateString("en-US", { timeZone: IST_TZ, weekday: "short" });
  const dateNum = parseInt(
    d.toLocaleDateString("en-US", { timeZone: IST_TZ, day: "numeric" }),
    10
  );
  const monthStr = d.toLocaleDateString("en-US", { timeZone: IST_TZ, month: "short" });
  const weekday = d.toLocaleDateString("en-US", { timeZone: IST_TZ, weekday: "long" });

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
