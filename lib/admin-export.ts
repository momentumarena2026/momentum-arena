import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { formatHoursAsRanges } from "@/lib/court-config";
import { splitBookingPayment, splitCafePayment } from "@/lib/payment-split";

/**
 * Monthly revenue + sales workbook generator.
 *
 * Three sheets:
 *   1. Summary       — KPI block + breakdown by sport / payment / day
 *   2. Bookings      — one row per CONFIRMED booking with a payment
 *                      confirmedAt inside the month (matches the
 *                      KPI dashboard's revenue bucket convention)
 *   3. Cafe Orders   — one row per non-cancelled cafe order placed
 *                      inside the month (createdAt — cafe doesn't
 *                      have a separate "confirmed" timestamp)
 *
 * "Month" is interpreted in IST (Asia/Kolkata) — same TZ all the
 * dashboards already use. Pass year + 1-indexed month (1..12).
 *
 * Returns a Buffer ready to be streamed back as a .xlsx file.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

interface MonthRange {
  start: Date;
  end: Date; // exclusive
  istLabel: string; // e.g. "May 2026"
}

function istMonthRange(year: number, month1to12: number): MonthRange {
  // Build "first instant of the month, IST" by going from a UTC
  // timestamp at IST midnight then converting back. We store +
  // compare in UTC throughout because Postgres TIMESTAMPTZs are UTC
  // — the IST framing is purely human-facing.
  const startUtcMs =
    Date.UTC(year, month1to12 - 1, 1, 0, 0, 0, 0) - IST_OFFSET_MS;
  const endUtcMs =
    Date.UTC(year, month1to12, 1, 0, 0, 0, 0) - IST_OFFSET_MS;

  const istLabel = new Date(startUtcMs).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    month: "long",
    year: "numeric",
  });

  return {
    start: new Date(startUtcMs),
    end: new Date(endUtcMs),
    istLabel,
  };
}

function fmtIst(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function fmtIstDate(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export interface MonthlyExportInput {
  year: number;
  month: number; // 1..12
}

export interface MonthlyExportOutput {
  buffer: Buffer;
  filename: string;
}

export async function exportMonthlyXlsx(
  input: MonthlyExportInput,
): Promise<MonthlyExportOutput> {
  const { start, end, istLabel } = istMonthRange(input.year, input.month);

  // ─── Pull data ────────────────────────────────────────────────
  // Bookings: bucket by Payment.confirmedAt to match the KPI dashboard.
  // We include CANCELLED bookings whose payment was confirmed (so the
  // refund row is visible) — the Status column makes it obvious.
  const bookings = await db.booking.findMany({
    where: {
      payment: {
        confirmedAt: { gte: start, lt: end },
      },
    },
    include: {
      user: { select: { name: true, phone: true } },
      courtConfig: { select: { sport: true, label: true } },
      slots: { orderBy: { startHour: "asc" } },
      payment: true,
      createdByAdmin: { select: { username: true } },
    },
    orderBy: { date: "asc" },
  });

  const cafeOrders = await db.cafeOrder.findMany({
    where: {
      createdAt: { gte: start, lt: end },
      // Exclude PENDING — those are still in flux. PREPARING +
      // READY + COMPLETED count as revenue (food's been served or
      // is in progress); CANCELLED kept and marked in the Status
      // column so refunds are visible.
      status: { in: ["PREPARING", "READY", "COMPLETED", "CANCELLED"] },
    },
    include: {
      user: { select: { name: true, phone: true } },
      items: { select: { quantity: true } },
      createdByAdmin: { select: { username: true } },
      payment: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // ─── Build workbook ───────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = "Momentum Arena admin";
  wb.created = new Date();

  // Sheet styling helper — header cells are emerald, body alternates.
  const HEADER_FILL: ExcelJS.FillPattern = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF10B981" }, // emerald-500
  };
  const HEADER_FONT: Partial<ExcelJS.Font> = {
    bold: true,
    color: { argb: "FFFFFFFF" },
    size: 11,
  };

  // ─── Sheet 1: Summary ─────────────────────────────────────────
  const summary = wb.addWorksheet("Summary", {
    properties: { defaultColWidth: 22 },
  });

  const bookingsRevenue = bookings
    .filter((b) => b.status !== "CANCELLED" && b.payment?.status !== "REFUNDED")
    .reduce((s, b) => s + (b.payment?.amount ?? 0), 0);
  const bookingsRefunded = bookings
    .filter(
      (b) => b.status === "CANCELLED" || b.payment?.status === "REFUNDED",
    )
    .reduce((s, b) => s + (b.payment?.amount ?? 0), 0);
  const cafeRevenue = cafeOrders
    .filter((o) => o.status !== "CANCELLED")
    .reduce((s, o) => s + o.totalAmount, 0);
  const cafeRefunded = cafeOrders
    .filter((o) => o.status === "CANCELLED")
    .reduce((s, o) => s + o.totalAmount, 0);
  const grossRevenue = bookingsRevenue + cafeRevenue;
  const netRevenue = grossRevenue - bookingsRefunded - cafeRefunded;

  summary.addRow([`Revenue & sales — ${istLabel}`]);
  summary.getRow(1).font = { size: 16, bold: true };
  summary.getRow(1).height = 24;
  summary.addRow([]);
  summary.addRow(["Metric", "Value (₹)"]);
  summary.getRow(3).font = HEADER_FONT;
  summary.getRow(3).fill = HEADER_FILL;

  const summaryRows: [string, number | string][] = [
    ["Bookings — confirmed revenue", bookingsRevenue],
    ["Bookings — refunded / cancelled", -bookingsRefunded],
    ["Cafe — order revenue", cafeRevenue],
    ["Cafe — cancelled orders", -cafeRefunded],
    ["Gross revenue", grossRevenue],
    ["Net revenue (gross − refunds)", netRevenue],
    ["", ""],
    ["Confirmed bookings count", bookings.filter((b) => b.status !== "CANCELLED").length],
    ["Cancelled bookings count", bookings.filter((b) => b.status === "CANCELLED").length],
    ["Cafe orders count", cafeOrders.filter((o) => o.status !== "CANCELLED").length],
  ];
  summaryRows.forEach((r) => summary.addRow(r));

  // Per-sport breakdown
  summary.addRow([]);
  summary.addRow(["By sport", "Bookings", "Revenue (₹)"]);
  const sportHeaderRow = summary.lastRow!;
  sportHeaderRow.font = HEADER_FONT;
  sportHeaderRow.fill = HEADER_FILL;

  const bySport = new Map<string, { count: number; revenue: number }>();
  for (const b of bookings) {
    if (b.status === "CANCELLED") continue;
    const sport = b.courtConfig.sport;
    const cur = bySport.get(sport) ?? { count: 0, revenue: 0 };
    cur.count += 1;
    cur.revenue += b.payment?.amount ?? 0;
    bySport.set(sport, cur);
  }
  for (const [sport, v] of bySport) {
    summary.addRow([sport, v.count, v.revenue]);
  }

  // Per-payment-method breakdown
  summary.addRow([]);
  summary.addRow(["By payment method", "Bookings", "Revenue (₹)"]);
  summary.lastRow!.font = HEADER_FONT;
  summary.lastRow!.fill = HEADER_FILL;
  const byMethod = new Map<string, { count: number; revenue: number }>();
  for (const b of bookings) {
    if (b.status === "CANCELLED") continue;
    const m = b.payment?.method ?? "UNKNOWN";
    const cur = byMethod.get(m) ?? { count: 0, revenue: 0 };
    cur.count += 1;
    cur.revenue += b.payment?.amount ?? 0;
    byMethod.set(m, cur);
  }
  for (const [m, v] of byMethod) {
    summary.addRow([m, v.count, v.revenue]);
  }

  // Per-platform breakdown — uses the Booking.platform column the
  // mobile-admin work added.
  summary.addRow([]);
  summary.addRow(["By platform", "Bookings", "Revenue (₹)"]);
  summary.lastRow!.font = HEADER_FONT;
  summary.lastRow!.fill = HEADER_FILL;
  const byPlatform = new Map<string, { count: number; revenue: number }>();
  for (const b of bookings) {
    if (b.status === "CANCELLED") continue;
    const cur = byPlatform.get(b.platform) ?? { count: 0, revenue: 0 };
    cur.count += 1;
    cur.revenue += b.payment?.amount ?? 0;
    byPlatform.set(b.platform, cur);
  }
  for (const [p, v] of byPlatform) {
    summary.addRow([p, v.count, v.revenue]);
  }

  // Per-collection-mode breakdown — answers "how much physical
  // cash did the venue handle this month vs UPI QR vs online
  // gateways". Rolls up the cash/upiQr/online split from BOTH the
  // bookings sheet and the cafe orders sheet so the totals match
  // the column SUMs across both.
  summary.addRow([]);
  summary.addRow(["By collection mode", "Bookings (₹)", "Cafe (₹)", "Total (₹)"]);
  summary.lastRow!.font = HEADER_FONT;
  summary.lastRow!.fill = HEADER_FILL;
  const bookingTotals = { cash: 0, upiQr: 0, online: 0, venueDiscount: 0 };
  for (const b of bookings) {
    if (b.status === "CANCELLED") continue;
    const s = splitBookingPayment(b.payment);
    bookingTotals.cash += s.cash;
    bookingTotals.upiQr += s.upiQr;
    bookingTotals.online += s.online;
    bookingTotals.venueDiscount += s.venueDiscount;
  }
  const cafeTotals = { cash: 0, upiQr: 0, online: 0 };
  for (const o of cafeOrders) {
    if (o.status === "CANCELLED") continue;
    const s = splitCafePayment(o.payment);
    cafeTotals.cash += s.cash;
    cafeTotals.upiQr += s.upiQr;
    cafeTotals.online += s.online;
  }
  summary.addRow([
    "Cash",
    bookingTotals.cash,
    cafeTotals.cash,
    bookingTotals.cash + cafeTotals.cash,
  ]);
  summary.addRow([
    "UPI QR",
    bookingTotals.upiQr,
    cafeTotals.upiQr,
    bookingTotals.upiQr + cafeTotals.upiQr,
  ]);
  summary.addRow([
    "Online (Razorpay/PhonePe)",
    bookingTotals.online,
    cafeTotals.online,
    bookingTotals.online + cafeTotals.online,
  ]);
  summary.addRow([
    "Discount at venue (booking only)",
    bookingTotals.venueDiscount,
    "",
    bookingTotals.venueDiscount,
  ]);

  summary.getColumn(1).width = 32;
  summary.getColumn(2).width = 18;
  summary.getColumn(3).width = 18;
  summary.getColumn(4).width = 18;

  // ─── Sheet 2: Bookings ────────────────────────────────────────
  const bookingsSheet = wb.addWorksheet("Bookings");
  bookingsSheet.columns = [
    { header: "Booking ID", key: "id", width: 28 },
    { header: "Play date", key: "date", width: 14 },
    { header: "Time slots", key: "slots", width: 22 },
    { header: "Sport", key: "sport", width: 12 },
    { header: "Court", key: "court", width: 16 },
    { header: "Customer", key: "customer", width: 22 },
    { header: "Phone", key: "phone", width: 16 },
    { header: "Total (₹)", key: "total", width: 12 },
    { header: "Discount (₹)", key: "discount", width: 12 },
    { header: "Paid (₹)", key: "paid", width: 12 },
    // ── Bifurcation by collection mode (advance + venue split) ──
    // For partial-payment bookings, the advance is paid via `method`
    // and the venue-side remainder is split across cash + UPI QR +
    // an optional goodwill discount. Each row's three columns sum
    // to "Paid (₹)" (Discount-at-venue is shown separately because
    // it's not money in — it's money written off).
    { header: "Cash (₹)", key: "cash", width: 12 },
    { header: "UPI QR (₹)", key: "upiQr", width: 12 },
    { header: "Online (₹)", key: "online", width: 12 },
    { header: "Discount at venue (₹)", key: "venueDiscount", width: 18 },
    { header: "Method", key: "method", width: 12 },
    { header: "Payment status", key: "paymentStatus", width: 14 },
    { header: "Booking status", key: "status", width: 14 },
    { header: "Platform", key: "platform", width: 10 },
    { header: "Confirmed at", key: "confirmedAt", width: 20 },
    { header: "Created by admin", key: "createdByAdmin", width: 18 },
  ];
  styleHeaderRow(bookingsSheet, HEADER_FILL, HEADER_FONT);

  for (const b of bookings) {
    const split = splitBookingPayment(b.payment);
    bookingsSheet.addRow({
      id: b.id,
      date: fmtIstDate(b.date),
      slots: formatHoursAsRanges(b.slots.map((s) => s.startHour)),
      sport: b.courtConfig.sport,
      court: b.courtConfig.label,
      customer: b.user?.name ?? "—",
      phone: b.user?.phone ?? "—",
      total: b.totalAmount,
      discount: b.discountAmount,
      paid: b.payment?.amount ?? 0,
      cash: split.cash,
      upiQr: split.upiQr,
      online: split.online,
      venueDiscount: split.venueDiscount,
      method: b.payment?.method ?? "—",
      paymentStatus: b.payment?.status ?? "—",
      status: b.status,
      platform: b.platform,
      confirmedAt: fmtIst(b.payment?.confirmedAt),
      createdByAdmin: b.createdByAdmin?.username ?? "—",
    });
  }
  bookingsSheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: bookingsSheet.columns.length },
  };

  // ─── Sheet 3: Cafe Orders ─────────────────────────────────────
  const cafeSheet = wb.addWorksheet("Cafe Orders");
  cafeSheet.columns = [
    { header: "Order #", key: "orderNumber", width: 12 },
    { header: "Date", key: "date", width: 20 },
    { header: "Customer", key: "customer", width: 22 },
    { header: "Phone", key: "phone", width: 16 },
    { header: "Items", key: "items", width: 8 },
    { header: "Subtotal (₹)", key: "subtotal", width: 12 },
    { header: "Discount (₹)", key: "discount", width: 12 },
    { header: "Total (₹)", key: "total", width: 12 },
    // Cafe doesn't have partial payments, so each order is paid via
    // exactly one method — Cash, UPI QR, or Online (Razorpay/PhonePe).
    // Three columns kept for layout symmetry with the Bookings sheet
    // so a finance person can SUM across both sheets in one go.
    { header: "Cash (₹)", key: "cash", width: 12 },
    { header: "UPI QR (₹)", key: "upiQr", width: 12 },
    { header: "Online (₹)", key: "online", width: 12 },
    { header: "Method", key: "method", width: 12 },
    { header: "Status", key: "status", width: 12 },
    { header: "Table", key: "table", width: 8 },
    { header: "Created by admin", key: "createdByAdmin", width: 18 },
  ];
  styleHeaderRow(cafeSheet, HEADER_FILL, HEADER_FONT);

  for (const o of cafeOrders) {
    const itemQty = o.items.reduce((s, it) => s + it.quantity, 0);
    const split = splitCafePayment(o.payment);
    cafeSheet.addRow({
      orderNumber: o.orderNumber,
      date: fmtIst(o.createdAt),
      customer: o.user?.name ?? o.guestName ?? "—",
      phone: o.user?.phone ?? o.guestPhone ?? "—",
      items: itemQty,
      subtotal: (o.originalAmount ?? o.totalAmount + o.discountAmount),
      discount: o.discountAmount,
      total: o.totalAmount,
      cash: split.cash,
      upiQr: split.upiQr,
      online: split.online,
      method: o.payment?.method ?? "—",
      status: o.status,
      table: o.tableNumber ?? "—",
      createdByAdmin: o.createdByAdmin?.username ?? "—",
    });
  }
  cafeSheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: cafeSheet.columns.length },
  };

  // ─── Output ───────────────────────────────────────────────────
  const arrayBuffer = await wb.xlsx.writeBuffer();
  const buffer = Buffer.from(arrayBuffer);
  // Filename pattern: momentum-arena_2026-05_revenue.xlsx
  const yyyy = String(input.year).padStart(4, "0");
  const mm = String(input.month).padStart(2, "0");
  const filename = `momentum-arena_${yyyy}-${mm}_revenue.xlsx`;
  return { buffer, filename };
}

// ─── Helpers ────────────────────────────────────────────────────
// splitBookingPayment + splitCafePayment moved to lib/payment-split.ts
// so the CA monthly report worker can share the same bifurcation
// logic without copy-paste drift.

function styleHeaderRow(
  sheet: ExcelJS.Worksheet,
  fill: ExcelJS.FillPattern,
  font: Partial<ExcelJS.Font>,
): void {
  const header = sheet.getRow(1);
  header.font = font;
  header.fill = fill;
  header.height = 22;
  header.alignment = { vertical: "middle" };
}
