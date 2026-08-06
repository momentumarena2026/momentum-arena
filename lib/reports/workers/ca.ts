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
      id: true,
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

  // Pass-value attribution per booking — the redeemed hours' worth at
  // the pass's effective rate. Informational only: the money was
  // recognised in "Pass Sales" at purchase, so this column must NOT be
  // added to the paid/cash/UPI/online sums.
  const redemptions = await db.passRedemption.findMany({
    where: {
      bookingId: { in: bookings.map((b) => b.id) },
      restoredAt: null,
    },
    select: { bookingId: true, value: true },
  });
  // One redemption row per contributing pass — SUM per booking (a
  // plain Map would keep only the last pass's value).
  const passValueByBooking = new Map<string, number>();
  for (const r of redemptions) {
    passValueByBooking.set(
      r.bookingId,
      (passValueByBooking.get(r.bookingId) ?? 0) + r.value,
    );
  }

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
    // Worth of pass-redeemed hours at the pass's effective rate.
    // Attribution only — that money is in "Pass Sales" (recognised at
    // purchase), so it is deliberately NOT part of Paid/Cash/UPI/Online.
    { header: "Pass value (₹)", key: "passValue", width: 14 },
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
      passValue: passValueByBooking.get(b.id) ?? 0,
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

  // 4. Pass sales — revenue recognised at PURCHASE (pass-paid
  // bookings show ₹0 in the sheets above, so nothing double-counts).
  const passSales = await db.userPass.findMany({
    where: { purchasedAt: { gte: monthStart, lt: monthEnd } },
    select: {
      purchasedAt: true,
      name: true,
      price: true,
      planId: true,
      paymentMethod: true,
      razorpayOrderId: true,
      phonePeMerchantTxnId: true,
      user: { select: { phone: true } },
    },
    orderBy: { purchasedAt: "asc" },
  });
  const passSheet = wb.addWorksheet("Pass Sales");
  passSheet.columns = [
    { header: "Date", key: "date", width: 20 },
    { header: "Pass", key: "name", width: 34 },
    { header: "Customer phone", key: "phone", width: 18 },
    { header: "Amount (₹)", key: "amount", width: 14 },
    { header: "Method", key: "method", width: 12 },
  ];
  styleHeaderRow(passSheet);
  for (const ps of passSales) {
    passSheet.addRow({
      date: fmtIst(ps.purchasedAt),
      name: ps.name,
      phone: ps.user.phone ?? "—",
      amount: ps.price,
      method: passReportMethod(ps),
    });
  }

  // 5. Tournament entry fees — sports income that never passes through
  // Booking/Payment, so without its own sheet it was simply missing from
  // the CA pack. Cash basis on paidAt, same as everything above.
  const tournamentIncome = await db.tournamentTeam.findMany({
    where: {
      status: "CONFIRMED",
      archivedAt: null,
      paidAmount: { gt: 0 },
      paidAt: { gte: monthStart, lt: monthEnd },
    },
    select: {
      paidAt: true,
      name: true,
      captainPhone: true,
      paidAmount: true,
      dueAmount: true,
      paymentMethod: true,
      couponCode: true,
      discount: true,
      tournament: { select: { name: true } },
    },
    orderBy: { paidAt: "asc" },
  });
  const tSheet = wb.addWorksheet("Tournament Entries");
  tSheet.columns = [
    { header: "Date", key: "date", width: 20 },
    { header: "Tournament", key: "tournament", width: 30 },
    { header: "Team", key: "team", width: 26 },
    { header: "Captain phone", key: "phone", width: 18 },
    { header: "Paid (₹)", key: "paid", width: 14 },
    { header: "Due at venue (₹)", key: "due", width: 16 },
    { header: "Method", key: "method", width: 14 },
    { header: "Coupon", key: "coupon", width: 14 },
    { header: "Discount (₹)", key: "discount", width: 14 },
  ];
  styleHeaderRow(tSheet);
  for (const t of tournamentIncome) {
    tSheet.addRow({
      date: t.paidAt ? fmtIst(t.paidAt) : "—",
      tournament: t.tournament.name,
      team: t.name,
      phone: t.captainPhone,
      paid: t.paidAmount,
      due: t.dueAmount,
      method: t.paymentMethod ?? "—",
      coupon: t.couponCode ?? "—",
      discount: t.discount,
    });
  }

  // 5b. Venue hire from third-party organisers. Appended to the SAME
  // sheet as entry fees rather than given its own, because the user asked
  // for this to read as tournament income — one sheet an accountant can
  // total. The Team column names the organiser so the two kinds of row
  // stay tellable apart, and there is no overlap with the rows above: a
  // THIRD_PARTY tournament's teams are never charged.
  const organizerIncome = await db.tournamentOrganizerPayment.findMany({
    where: { receivedAt: { gte: monthStart, lt: monthEnd } },
    select: {
      receivedAt: true,
      amount: true,
      method: true,
      reference: true,
      tournament: {
        select: { name: true, organizerName: true, organizerPhone: true, quotedAmount: true },
      },
    },
    orderBy: { receivedAt: "asc" },
  });
  for (const o of organizerIncome) {
    tSheet.addRow({
      date: fmtIst(o.receivedAt),
      tournament: o.tournament.name,
      team: `Venue hire — ${o.tournament.organizerName ?? "organiser"}`,
      phone: o.tournament.organizerPhone ?? "—",
      paid: o.amount,
      due: 0,
      method: o.method,
      coupon: o.reference ?? "—",
      discount: 0,
    });
  }

  // 6. Camp fees — same story as tournaments.
  const campIncome = await db.campRegistration.findMany({
    where: {
      status: "CONFIRMED",
      archivedAt: null,
      paidAmount: { gt: 0 },
      paidAt: { gte: monthStart, lt: monthEnd },
    },
    select: {
      paidAt: true,
      participantName: true,
      phone: true,
      paidAmount: true,
      dueAmount: true,
      paymentMethod: true,
      couponCode: true,
      discount: true,
      camp: { select: { name: true } },
    },
    orderBy: { paidAt: "asc" },
  });
  const cSheet = wb.addWorksheet("Camp Registrations");
  cSheet.columns = [
    { header: "Date", key: "date", width: 20 },
    { header: "Camp", key: "camp", width: 30 },
    { header: "Participant", key: "participant", width: 26 },
    { header: "Phone", key: "phone", width: 18 },
    { header: "Paid (₹)", key: "paid", width: 14 },
    { header: "Due at venue (₹)", key: "due", width: 16 },
    { header: "Method", key: "method", width: 14 },
    { header: "Coupon", key: "coupon", width: 14 },
    { header: "Discount (₹)", key: "discount", width: 14 },
  ];
  styleHeaderRow(cSheet);
  for (const c of campIncome) {
    cSheet.addRow({
      date: c.paidAt ? fmtIst(c.paidAt) : "—",
      camp: c.camp.name,
      participant: c.participantName,
      phone: c.phone,
      paid: c.paidAmount,
      due: c.dueAmount,
      method: c.paymentMethod ?? "—",
      coupon: c.couponCode ?? "—",
      discount: c.discount,
    });
  }

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

/** How a pass was paid, for the Pass Sales sheet — offline method if
 *  stamped (admin-issued at the venue), else inferred from the gateway
 *  refs. */
function passReportMethod(p: {
  planId: string | null;
  paymentMethod: string | null;
  razorpayOrderId: string | null;
  phonePeMerchantTxnId: string | null;
}): string {
  if (!p.planId) return "Gift";
  switch (p.paymentMethod) {
    case "CASH":
      return "Cash";
    case "UPI_QR":
      return "Static QR";
    case "FREE":
      return "Free";
  }
  if (p.phonePeMerchantTxnId) return "UPI (DQR)";
  return "Razorpay";
}

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
