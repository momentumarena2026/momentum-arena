import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import {
  splitBookingPayment,
  splitCafePayment,
} from "@/lib/payment-split";

/**
 * CA monthly report worker.
 *
 * Stripped-down workbook for the chartered accountant's monthly
 * filing. Only payment-relevant columns — no booking IDs, slots,
 * customer names, etc. The CA needs to see "what came in via what
 * channel on what date" and not much else.
 *
 * Bookings sheet (8 columns, exact match to the format the CA
 *   asked for):
 *     Play date · Total · Paid · Cash · UPI QR · Online ·
 *     Discount at venue · Method
 *
 * Cafe Orders sheet (7 columns — same shape minus "Discount at
 *   venue", which only applies to bookings):
 *     Date · Total · Paid · Cash · UPI QR · Online · Method
 *
 * Both sheets only include rows with a matching status:
 *   - Bookings: CONFIRMED, with a Payment.confirmedAt inside the
 *     month (matches the dashboard's revenue bucket).
 *   - Cafe orders: PREPARING / READY / COMPLETED (placed inside
 *     the month). Cancelled orders are excluded — they're not in
 *     the books.
 *
 * Amounts in rupees (no paise conversion needed — the schema
 * stores rupees directly; same convention as the sales report).
 */

const HEADER_FILL: ExcelJS.FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF10B981" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
};

export async function generateCaMonthlyReport(input: {
  year: number;
  month: number;
}): Promise<{ filename: string; bytes: Buffer }> {
  const monthStart = new Date(Date.UTC(input.year, input.month - 1, 1));
  const monthEnd = new Date(Date.UTC(input.year, input.month, 1));

  // ─── Fetch the data ────────────────────────────────────────────
  const bookings = await db.booking.findMany({
    where: {
      status: "CONFIRMED",
      payment: {
        confirmedAt: { gte: monthStart, lt: monthEnd },
      },
    },
    select: {
      date: true,
      totalAmount: true,
      payment: {
        select: {
          amount: true,
          method: true,
          isPartialPayment: true,
          advanceAmount: true,
          remainingAmount: true,
          remainderMethod: true,
          remainderCashAmount: true,
          remainderUpiAmount: true,
          remainderDiscountAmount: true,
        },
      },
    },
    orderBy: { date: "asc" },
  });

  const cafeOrders = await db.cafeOrder.findMany({
    where: {
      createdAt: { gte: monthStart, lt: monthEnd },
      status: { in: ["PREPARING", "READY", "COMPLETED"] },
    },
    select: {
      createdAt: true,
      totalAmount: true,
      payment: {
        select: { amount: true, method: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // ─── Build workbook ────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = "Momentum Arena admin";
  wb.created = new Date();

  // 1. Bookings — exact 8-column shape the CA asked for.
  const bookingsSheet = wb.addWorksheet("Bookings");
  bookingsSheet.columns = [
    { header: "Play date", key: "date", width: 14 },
    { header: "Total (₹)", key: "total", width: 12 },
    { header: "Paid (₹)", key: "paid", width: 12 },
    { header: "Cash (₹)", key: "cash", width: 12 },
    { header: "UPI QR (₹)", key: "upiQr", width: 12 },
    { header: "Online (₹)", key: "online", width: 12 },
    { header: "Discount at venue (₹)", key: "venueDiscount", width: 18 },
    { header: "Method", key: "method", width: 12 },
  ];
  styleHeaderRow(bookingsSheet);

  for (const b of bookings) {
    const split = splitBookingPayment(b.payment);
    bookingsSheet.addRow({
      date: fmtIstDate(b.date),
      total: b.totalAmount,
      paid: b.payment?.amount ?? 0,
      cash: split.cash,
      upiQr: split.upiQr,
      online: split.online,
      venueDiscount: split.venueDiscount,
      method: b.payment?.method ?? "—",
    });
  }
  bookingsSheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: bookingsSheet.columns.length },
  };

  // 2. Cafe orders — same trimmed shape (no "Discount at venue").
  const cafeSheet = wb.addWorksheet("Cafe Orders");
  cafeSheet.columns = [
    { header: "Date", key: "date", width: 20 },
    { header: "Total (₹)", key: "total", width: 12 },
    { header: "Paid (₹)", key: "paid", width: 12 },
    { header: "Cash (₹)", key: "cash", width: 12 },
    { header: "UPI QR (₹)", key: "upiQr", width: 12 },
    { header: "Online (₹)", key: "online", width: 12 },
    { header: "Method", key: "method", width: 12 },
  ];
  styleHeaderRow(cafeSheet);

  for (const o of cafeOrders) {
    const split = splitCafePayment(o.payment);
    cafeSheet.addRow({
      date: fmtIst(o.createdAt),
      total: o.totalAmount,
      paid: o.payment?.amount ?? 0,
      cash: split.cash,
      upiQr: split.upiQr,
      online: split.online,
      method: o.payment?.method ?? "—",
    });
  }
  cafeSheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: cafeSheet.columns.length },
  };

  // ─── Output ────────────────────────────────────────────────────
  const ab = await wb.xlsx.writeBuffer();
  const bytes = Buffer.from(ab);
  const yyyy = String(input.year).padStart(4, "0");
  const mm = String(input.month).padStart(2, "0");
  const filename = `momentum-arena_${yyyy}-${mm}_ca-report.xlsx`;
  return { filename, bytes };
}

// ─── Local formatting helpers ─────────────────────────────────────
// Duplicated from admin-export.ts so the worker stays self-
// contained — these are tiny formatters; not worth a shared module.

function fmtIstDate(d: Date): string {
  return d.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtIst(d: Date): string {
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

function styleHeaderRow(sheet: ExcelJS.Worksheet): void {
  const headerRow = sheet.getRow(1);
  headerRow.font = HEADER_FONT;
  headerRow.fill = HEADER_FILL;
  headerRow.alignment = { vertical: "middle", horizontal: "left" };
  headerRow.height = 22;
}
