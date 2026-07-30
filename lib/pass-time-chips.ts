import type { Band } from "@/lib/pass-bands";

/**
 * Turn a pass's pricing bands into human time chips ("Weekdays 5am–5pm")
 * by resolving each band against the admin's Peak / Off-peak hour bands
 * (TimeClassification). Pure — both the web storefront action and the
 * mobile plans API feed it the same rows.
 *
 * tone drives the chip colour on the cards: "day" (sky) for windows that
 * start in the morning/afternoon, "night" (dark) for evening starts.
 */
export type TimeChip = { label: string; tone: "day" | "night" };

export type ClassificationRow = {
  startHour: number;
  endHour: number;
  dayType: string;
  timeType: string;
};

const DAY_LABEL: Record<string, string> = {
  WEEKDAY: "Weekdays",
  WEEKEND: "Weekends",
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
  const chips: TimeChip[] = [];
  const seen = new Set<string>();
  for (const band of bands) {
    const rows = classifications
      .filter((c) => c.dayType === band.dayType && c.timeType === band.timeType)
      .sort((a, b) => a.startHour - b.startHour);
    for (const row of rows) {
      const label = `${DAY_LABEL[band.dayType] ?? band.dayType} ${fmtHour(row.startHour)}–${fmtHour(row.endHour)}`;
      if (seen.has(label)) continue;
      seen.add(label);
      // Evening starts read as "night" — 4pm onward covers the floodlit
      // windows without stealing the afternoon off-peak block.
      chips.push({ label, tone: row.startHour >= 16 ? "night" : "day" });
    }
  }
  return chips;
}
