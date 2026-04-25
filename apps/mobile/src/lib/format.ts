/**
 * Formatting helpers used across the mobile app.
 *
 * Prices are stored as rupees directly in the DB (Prisma `Int`), so no
 * paise→rupee conversion is needed — just format for display.
 */

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatRupees(amount: number): string {
  if (Number.isInteger(amount)) {
    return `₹${amount.toLocaleString("en-IN")}`;
  }
  return `₹${amount.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatDate(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return `${DAYS_SHORT[d.getUTCDay()]}, ${d.getUTCDate()} ${
    MONTHS_SHORT[d.getUTCMonth()]
  }`;
}

export function formatDateLong(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return `${DAYS_SHORT[d.getUTCDay()]}, ${d.getUTCDate()} ${
    MONTHS_SHORT[d.getUTCMonth()]
  } ${d.getUTCFullYear()}`;
}

/** Turn 14 into "2 PM", 14.5 into "2:30 PM". */
export function formatHour(hour: number): string {
  const h = Math.floor(hour);
  const mins = Math.round((hour - h) * 60);
  const period = h >= 12 ? "PM" : "AM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return mins === 0 ? `${display} ${period}` : `${display}:${String(mins).padStart(2, "0")} ${period}`;
}

/** Turn 17 into "5pm", 0 into "12am" — matches web's formatHourCompact. */
export function formatHourCompact(hour: number): string {
  const h = hour % 24;
  if (h === 0) return "12am";
  if (h === 12) return "12pm";
  if (h < 12) return `${h}am`;
  return `${h - 12}pm`;
}

/** Turn 17 into "5pm - 6pm" — matches web's formatHourRangeCompact. */
export function formatHourRangeCompact(startHour: number): string {
  return `${formatHourCompact(startHour)} - ${formatHourCompact(startHour + 1)}`;
}

/** Merge consecutive sorted hours into compact ranges. e.g. [17,18,19,22] → "5pm - 8pm, 10pm - 11pm" */
export function formatHoursAsRanges(hours: number[]): string {
  if (hours.length === 0) return "";
  const sorted = [...hours].sort((a, b) => a - b);
  const groups: [number, number][] = [];
  let start = sorted[0];
  let end = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end + 1) {
      end = sorted[i];
    } else {
      groups.push([start, end]);
      start = sorted[i];
      end = sorted[i];
    }
  }
  groups.push([start, end]);
  return groups
    .map(([s, e]) => `${formatHourCompact(s)} - ${formatHourCompact(e + 1)}`)
    .join(", ");
}

/** Given sorted start hours [18, 19, 20], produce "6 PM – 9 PM". */
export function formatHourRange(hours: number[]): string {
  if (hours.length === 0) return "";
  const sorted = [...hours].sort((a, b) => a - b);
  const start = sorted[0];
  const end = sorted[sorted.length - 1] + 1;
  return `${formatHour(start)} – ${formatHour(end)}`;
}

export function sportLabel(sport: string): string {
  switch (sport) {
    case "CRICKET":
      return "Cricket";
    case "FOOTBALL":
      return "Football";
    case "PICKLEBALL":
      return "Pickleball";
    default:
      return sport;
  }
}

export function sportEmoji(sport: string): string {
  switch (sport) {
    case "CRICKET":
      return "🏏";
    case "FOOTBALL":
      return "⚽";
    case "PICKLEBALL":
      return "🥒";
    default:
      return "🏟️";
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case "CONFIRMED":
      return "Confirmed";
    case "PENDING":
      return "Pending";
    case "CANCELLED":
      return "Cancelled";
    default:
      return status;
  }
}

export function categoryLabel(category: string): string {
  switch (category) {
    case "SNACKS":
      return "Snacks";
    case "BEVERAGES":
      return "Beverages";
    case "MEALS":
      return "Meals";
    case "DESSERTS":
      return "Desserts";
    case "COMBOS":
      return "Combos";
    default:
      return category;
  }
}
