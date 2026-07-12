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
 * Cafe Item Sales sheet (3 columns, per the CA's ask):
 *     Item name · Total qty sold · Total price (₹)
 *   Aggregated from CafeOrderItem LINE SNAPSHOTS (itemName +
 *   totalPrice captured at order time), so menu items renamed or
 *   deleted after the sale still report under what the customer
 *   actually paid. Same order-status filter as the Cafe Orders
 *   sheet, so the two reconcile within the workbook. Line values
 *   are GROSS — order-level coupon discounts live on the order,
 *   not the line, and can't be apportioned per item.
 *
 * All sheets only include rows with a matching status:
 *   - Bookings: CONFIRMED, with a Payment.confirmedAt inside the
 *     month (matches the dashboard's revenue bucket).
 *   - Cafe orders / item lines: PREPARING / READY / COMPLETED
 *     (placed inside the month). Cancelled orders are excluded —
 *     they're not in the books.
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

  // Item-level lines for the "Cafe Item Sales" sheet — same status
  // filter + month window as the Cafe Orders sheet above, so the two
  // reconcile within this workbook.
  const cafeLines = await db.cafeOrderItem.findMany({
    where: {
      order: {
        createdAt: { gte: monthStart, lt: monthEnd },
        status: { in: ["PREPARING", "READY", "COMPLETED"] },
      },
    },
    select: { itemName: true, quantity: true, totalPrice: true },
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

  // 3. Cafe item sales — the CA's per-item mix: exactly three data
  // columns, best-sellers first, styled TOTALS row at the bottom.
  const itemAgg = new Map<string, { qty: number; total: number }>();
  for (const l of cafeLines) {
    const cur = itemAgg.get(l.itemName) ?? { qty: 0, total: 0 };
    cur.qty += l.quantity;
    cur.total += l.totalPrice;
    itemAgg.set(l.itemName, cur);
  }
  const itemRows = [...itemAgg.entries()]
    .map(([name, a]) => ({ name, qty: a.qty, total: a.total }))
    .sort((a, b) => {
      if (b.qty !== a.qty) return b.qty - a.qty;
      return a.name.localeCompare(b.name);
    });

  const itemSheet = wb.addWorksheet("Cafe Item Sales");
  itemSheet.columns = [
    { header: "Item name", key: "name", width: 34 },
    { header: "Total qty sold", key: "qty", width: 16 },
    { header: "Total price (₹)", key: "total", width: 18 },
  ];
  styleHeaderRow(itemSheet);

  for (const r of itemRows) {
    const row = itemSheet.addRow({
      name: r.name,
      qty: r.qty,
      // Round to paise so Float dust (0.1+0.2 style) never reaches the CA.
      total: Math.round(r.total * 100) / 100,
    });
    row.getCell("total").numFmt = "#,##0.00";
  }
  if (itemRows.length > 0) {
    const totalRow = itemSheet.addRow({
      name: "TOTALS",
      qty: itemRows.reduce((s, r) => s + r.qty, 0),
      total:
        Math.round(itemRows.reduce((s, r) => s + r.total, 0) * 100) / 100,
    });
    totalRow.getCell("total").numFmt = "#,##0.00";
    totalRow.eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1F2937" },
      };
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    });
  }
  itemSheet.views = [{ state: "frozen", ySplit: 1 }];

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
