import type { Band } from "@/lib/pass-bands";

/**
 * Turn a pass's pricing bands into time chips by resolving them against
 * the admin's Peak / Off-peak hour bands (TimeClassification). Pure —
 * both the web storefront action and the mobile plans API feed it the
 * same rows.
 *
 * One chip per time bucket, NOT per day type — "5pm–1am" reads the same
 * whether it's a weekday or weekend band (and when the hours differ the
 * ranges are joined with " · "). tone drives the chip colour and the
 * big sun/moon icon: "day" for off-peak daytime windows, "night" for
 * peak evening windows.
 */
export type TimeChip = { label: string; tone: "day" | "night" };

export type ClassificationRow = {
  startHour: number;
  endHour: number;
  dayType: string;
  timeType: string;
};

/** 17 → "5pm", 24 → "12am", 25 → "1am" (arena hours run past midnight). */
function fmtHour(h: number): string {
  const x = ((h % 24) + 24) % 24;
  if (x === 0) return "12am";
  if (x === 12) return "12pm";
  return x < 12 ? `${x}am` : `${x - 12}pm`;
}

export function passTimeChips(
  bands: Band[],
  classifications: ClassificationRow[],
): TimeChip[] {
  // Collect every classification window the pass's bands cover, grouped
  // by timeType so weekday/weekend collapse into one chip.
  const rangesByType = new Map<string, Set<string>>();
  const startByType = new Map<string, number>();
  for (const band of bands) {
    const rows = classifications
      .filter((c) => c.dayType === band.dayType && c.timeType === band.timeType)
      .sort((a, b) => a.startHour - b.startHour);
    for (const row of rows) {
      const range = `${fmtHour(row.startHour)}–${fmtHour(row.endHour)}`;
      if (!rangesByType.has(band.timeType)) {
        rangesByType.set(band.timeType, new Set());
        startByType.set(band.timeType, row.startHour);
      }
      rangesByType.get(band.timeType)!.add(range);
      startByType.set(
        band.timeType,
        Math.min(startByType.get(band.timeType) ?? row.startHour, row.startHour),
      );
    }
  }

  // Deterministic order: day chips before night chips.
  const entries = [...rangesByType.entries()].map(([timeType, ranges]) => {
    const start = startByType.get(timeType) ?? 0;
    return {
      label: [...ranges].join(" · "),
      // Evening starts read as "night" — 4pm onward covers the floodlit
      // windows without stealing the afternoon off-peak block.
      tone: (start >= 16 ? "night" : "day") as "day" | "night",
    };
  });
  entries.sort((a) => (a.tone === "day" ? -1 : 1));
  return entries;
}
