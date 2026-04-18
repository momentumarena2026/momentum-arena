import PDFDocument from "pdfkit";
import { db } from "./db";
import { SPORT_INFO, SIZE_INFO, formatHourRangeCompact } from "./court-config";
import type { DayType, Sport, TimeType } from "@prisma/client";

/**
 * Generate the public "sports pricing" PDF from the live pricing rules +
 * time classifications in the database.
 *
 * Output: a Buffer containing the PDF bytes, ready to be stored in
 * CachedDocument or streamed back in an HTTP response.
 *
 * The PDF regenerates nightly via the /api/cron/refresh-pricing-pdf cron
 * at 5:00 AM IST. Between regenerations the cached copy is served as-is
 * so prod never runs the Prisma + pdfkit pipeline on hot request paths.
 *
 * Later we'll add a sibling generator for the cafe menu using the same
 * CachedDocument pattern.
 */
export async function generateSportsPricingPdf(): Promise<Buffer> {
  // Fetch live data
  const [configs, pricingRules, timeClassifications] = await Promise.all([
    db.courtConfig.findMany({
      where: { isActive: true },
      orderBy: [{ sport: "asc" }, { size: "asc" }, { position: "asc" }],
    }),
    db.pricingRule.findMany(),
    db.timeClassification.findMany({
      orderBy: [{ dayType: "asc" }, { startHour: "asc" }],
    }),
  ]);

  // Build a lookup: {courtConfigId -> {dayType -> {timeType -> pricePerSlot}}}
  const priceMap = new Map<string, Map<DayType, Map<TimeType, number>>>();
  for (const rule of pricingRules) {
    if (!priceMap.has(rule.courtConfigId)) {
      priceMap.set(rule.courtConfigId, new Map());
    }
    const byDay = priceMap.get(rule.courtConfigId)!;
    if (!byDay.has(rule.dayType)) byDay.set(rule.dayType, new Map());
    byDay.get(rule.dayType)!.set(rule.timeType, rule.pricePerSlot);
  }

  // Build time-type windows for display (one per day type)
  const windows = {
    WEEKDAY: { PEAK: [] as number[], OFF_PEAK: [] as number[] },
    WEEKEND: { PEAK: [] as number[], OFF_PEAK: [] as number[] },
  };
  for (const tc of timeClassifications) {
    windows[tc.dayType][tc.timeType].push(tc.startHour);
  }

  // Group configs by sport
  const configsBySport = new Map<Sport, typeof configs>();
  for (const c of configs) {
    if (!configsBySport.has(c.sport)) configsBySport.set(c.sport, []);
    configsBySport.get(c.sport)!.push(c);
  }

  // PDF construction
  const chunks: Buffer[] = [];
  const doc = new PDFDocument({
    size: "A4",
    margin: 48,
    info: {
      Title: "Momentum Arena — Sports Pricing",
      Author: "Momentum Arena",
      Subject: "Slot pricing",
    },
  });
  doc.on("data", (chunk) => chunks.push(chunk));

  // --- Header --------------------------------------------------------------
  doc
    .fontSize(22)
    .fillColor("#10b981")
    .font("Helvetica-Bold")
    .text("MOMENTUM ARENA", { align: "center" });
  doc
    .fontSize(10)
    .fillColor("#52525b")
    .font("Helvetica")
    .text("Mathura's premium multi-sport facility", { align: "center" });
  doc
    .moveDown(0.25)
    .fontSize(9)
    .fillColor("#71717a")
    .text("Cricket • Football • Pickleball • Badminton", { align: "center" });
  doc.moveDown(0.75);
  doc
    .fontSize(16)
    .fillColor("#18181b")
    .font("Helvetica-Bold")
    .text("Sports Slot Pricing", { align: "center" });
  doc.moveDown(0.75);

  // --- Peak/Off-peak window summary ---------------------------------------
  const formatWindows = (hours: number[]) => {
    if (hours.length === 0) return "—";
    const sorted = [...hours].sort((a, b) => a - b);
    // Merge contiguous runs into one "6pm - 10pm" style range
    const ranges: string[] = [];
    let runStart = sorted[0];
    let runEnd = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === runEnd + 1) {
        runEnd = sorted[i];
      } else {
        ranges.push(
          runStart === runEnd
            ? formatHourRangeCompact(runStart)
            : `${formatHourRangeCompact(runStart).split(" - ")[0]} - ${formatHourRangeCompact(runEnd).split(" - ")[1]}`
        );
        runStart = sorted[i];
        runEnd = sorted[i];
      }
    }
    ranges.push(
      runStart === runEnd
        ? formatHourRangeCompact(runStart)
        : `${formatHourRangeCompact(runStart).split(" - ")[0]} - ${formatHourRangeCompact(runEnd).split(" - ")[1]}`
    );
    return ranges.join(", ");
  };

  doc
    .fontSize(10)
    .fillColor("#18181b")
    .font("Helvetica-Bold")
    .text("Pricing Tiers");
  doc.moveDown(0.25);
  doc
    .fontSize(9)
    .fillColor("#3f3f46")
    .font("Helvetica")
    .text(
      `Weekday (Mon–Fri)   Peak: ${formatWindows(windows.WEEKDAY.PEAK)}   •   Off-Peak: ${formatWindows(windows.WEEKDAY.OFF_PEAK)}`
    );
  doc.text(
    `Weekend (Sat–Sun)   Peak: ${formatWindows(windows.WEEKEND.PEAK)}   •   Off-Peak: ${formatWindows(windows.WEEKEND.OFF_PEAK)}`
  );
  doc.moveDown(0.75);

  // --- Per-sport pricing tables -------------------------------------------
  const formatPrice = (paiseOrRupees: number | undefined) =>
    paiseOrRupees === undefined ? "—" : `\u20B9${paiseOrRupees.toLocaleString("en-IN")}`;

  const sportOrder: Sport[] = ["CRICKET", "FOOTBALL", "PICKLEBALL", "BADMINTON"];
  for (const sport of sportOrder) {
    const sportConfigs = configsBySport.get(sport);
    if (!sportConfigs || sportConfigs.length === 0) continue;

    if (doc.y > 700) doc.addPage();

    doc
      .moveDown(0.5)
      .fontSize(13)
      .fillColor("#10b981")
      .font("Helvetica-Bold")
      .text(SPORT_INFO[sport].name);
    doc.moveDown(0.15);

    // Table header row
    const tableLeft = 48;
    const col1 = tableLeft;            // Court label
    const col2 = tableLeft + 210;      // Weekday Off-Peak
    const col3 = tableLeft + 290;      // Weekday Peak
    const col4 = tableLeft + 370;      // Weekend Off-Peak
    const col5 = tableLeft + 450;      // Weekend Peak

    doc
      .fontSize(8)
      .fillColor("#52525b")
      .font("Helvetica-Bold");
    doc.text("Court", col1, doc.y, { width: 200 });
    const headerY = doc.y - 10; // retreat so next texts line up
    doc.text("Wkday Off-Peak", col2, headerY, { width: 75 });
    doc.text("Wkday Peak", col3, headerY, { width: 75 });
    doc.text("Wknd Off-Peak", col4, headerY, { width: 75 });
    doc.text("Wknd Peak", col5, headerY, { width: 75 });

    // Header separator
    doc
      .moveTo(tableLeft, doc.y + 1)
      .lineTo(540, doc.y + 1)
      .lineWidth(0.5)
      .strokeColor("#d4d4d8")
      .stroke();

    // Rows
    doc.font("Helvetica").fillColor("#18181b").fontSize(9);
    for (const config of sportConfigs) {
      if (doc.y > 760) doc.addPage();
      const prices = priceMap.get(config.id);
      const wdop = prices?.get("WEEKDAY")?.get("OFF_PEAK");
      const wdp = prices?.get("WEEKDAY")?.get("PEAK");
      const weop = prices?.get("WEEKEND")?.get("OFF_PEAK");
      const wep = prices?.get("WEEKEND")?.get("PEAK");

      const rowY = doc.y + 4;
      const sizeLabel = SIZE_INFO[config.size]?.name ?? config.size;
      doc.text(`${sizeLabel} — ${config.label}`, col1, rowY, { width: 200 });
      doc.text(formatPrice(wdop), col2, rowY, { width: 75 });
      doc.text(formatPrice(wdp), col3, rowY, { width: 75 });
      doc.text(formatPrice(weop), col4, rowY, { width: 75 });
      doc.text(formatPrice(wep), col5, rowY, { width: 75 });
      doc.moveDown(0.4);
    }
    doc.moveDown(0.25);
  }

  // --- Terms & Conditions -------------------------------------------------
  if (doc.y > 620) doc.addPage();
  doc.moveDown(1);
  doc
    .fontSize(11)
    .fillColor("#18181b")
    .font("Helvetica-Bold")
    .text("Terms & Conditions");
  doc.moveDown(0.3);
  doc.fontSize(8.5).fillColor("#3f3f46").font("Helvetica");
  const tnc = [
    "Prices are per slot of 1 hour and are subject to change without prior notice. Always refer to the live prices on momentumarena.com at the time of booking.",
    "Displayed rates are inclusive of applicable taxes.",
    "Slot booking is subject to real-time availability on the website.",
    "Advance payment of 50% (or higher, at admin discretion) is required to confirm certain bookings; the remainder is payable in cash or UPI at the venue before the slot begins.",
    "Bookings cancelled within 24 hours of the slot are non-refundable. Cancellations made earlier may be rescheduled based on availability.",
    "The venue reserves the right to cancel or reschedule slots due to weather, equipment issues, or maintenance; full credit will be issued in such cases.",
    "Equipment (stumps, bats, and balls for cricket) is included in the slot price where mentioned. For other sports, customers should bring their own gear.",
    "Children under 12 must be accompanied by a guardian on the court.",
    "The venue is not responsible for personal belongings; lockers are available on a first-come basis.",
    "By booking a slot, customers agree to the full policy published on momentumarena.com.",
  ];
  for (const item of tnc) {
    doc.text(`•  ${item}`, { indent: 4, paragraphGap: 3 });
  }

  // --- Venue info footer --------------------------------------------------
  doc.moveDown(0.75);
  doc
    .fontSize(9)
    .fillColor("#18181b")
    .font("Helvetica-Bold")
    .text("Visit / Book / Contact");
  doc.moveDown(0.2);
  doc.font("Helvetica").fillColor("#3f3f46").fontSize(9);
  doc.text("Momentum Arena, Mathura (Uttar Pradesh)");
  doc.text("Operating hours: 6:00 AM — 11:00 PM, all days");
  doc.text("Book online: https://www.momentumarena.com");
  doc.text("Reservations & enquiries: +91 63961 77261");

  // --- Generation timestamp footer (bottom of final page) ------------------
  const pageRange = doc.bufferedPageRange();
  for (let i = 0; i < pageRange.count; i++) {
    doc.switchToPage(pageRange.start + i);
    doc
      .fontSize(7)
      .fillColor("#a1a1aa")
      .font("Helvetica")
      .text(
        `Generated ${new Date().toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          dateStyle: "long",
          timeStyle: "short",
        })}  •  Page ${i + 1} of ${pageRange.count}`,
        48,
        810,
        { align: "center", width: 499 }
      );
  }

  doc.end();

  return new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}
