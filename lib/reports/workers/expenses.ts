import ExcelJS from "exceljs";
import { db } from "@/lib/db";

/**
 * Monthly expenses report.
 *
 * Two sheets:
 *   1. Details    — one row per Expense entry in the month, sorted
 *                   by date asc, with every column from the table
 *                   (date, description, amount, paymentType, doneBy,
 *                   toName, vendor, spentType, note).
 *   2. By person  — aggregate of TOTAL spend grouped by Expense.doneBy
 *                   (the staff member who paid out / settled the
 *                   transaction). Includes per-person count of entries
 *                   so the ops team can spot outliers ("Anand spent
 *                   ₹1.2L across 47 entries" vs "Nakul ₹2.4L across
 *                   only 8").
 *
 * Amounts are in rupees (Expense.amount is stored as Int rupees, no
 * paise conversion — same convention as Booking.totalAmount).
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
const TOTAL_ROW_FILL: ExcelJS.FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1F2937" }, // zinc-800-ish
};
const TOTAL_ROW_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
};

export async function generateExpensesMonthlyReport(input: {
  year: number;
  month: number;
}): Promise<{ filename: string; bytes: Buffer }> {
  const monthStart = new Date(Date.UTC(input.year, input.month - 1, 1));
  const monthEnd = new Date(Date.UTC(input.year, input.month, 1));
  const yyyy = String(input.year).padStart(4, "0");
  const mm = String(input.month).padStart(2, "0");
  return buildExpensesReport({
    where: { date: { gte: monthStart, lt: monthEnd } },
    filename: `momentum-arena_${yyyy}-${mm}_expenses.xlsx`,
  });
}

/**
 * "From day 1" variant. No date filter — every Expense row in the
 * DB ends up in the workbook. The request's year/month are
 * persisted on the Report row for ordering/audit but ignored by
 * the worker. Filename uses today's date so re-runs land in
 * separate downloads (admins can tell "the all-time pull as of
 * the day they queued it").
 */
export async function generateExpensesLifetimeReport(_input: {
  year: number;
  month: number;
}): Promise<{ filename: string; bytes: Buffer }> {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  return buildExpensesReport({
    where: {}, // no date filter
    filename: `momentum-arena_${yyyy}-${mm}-${dd}_expenses-lifetime.xlsx`,
  });
}

/**
 * Shared workbook builder. Identical layout for monthly vs
 * lifetime — only the Prisma `where` clause + the output filename
 * differ. Extracted so the two entrypoints can't drift apart.
 */
async function buildExpensesReport(opts: {
  where: { date?: { gte: Date; lt: Date } };
  filename: string;
}): Promise<{ filename: string; bytes: Buffer }> {
  const expenses = await db.expense.findMany({
    where: opts.where,
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    select: {
      date: true,
      description: true,
      amount: true,
      paymentType: true,
      doneBy: true,
      toName: true,
      vendor: true,
      spentType: true,
      note: true,
    },
  });

  // ─── Build workbook ────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = "Momentum Arena admin";
  wb.created = new Date();

  // 1. Details sheet — every row, full column set.
  const detailsSheet = wb.addWorksheet("Details");
  detailsSheet.columns = [
    { header: "Date", key: "date", width: 14 },
    { header: "Description", key: "description", width: 36 },
    { header: "Amount (₹)", key: "amount", width: 12 },
    { header: "Payment type", key: "paymentType", width: 14 },
    { header: "Done by", key: "doneBy", width: 16 },
    { header: "To (recipient)", key: "toName", width: 24 },
    { header: "Vendor / bucket", key: "vendor", width: 18 },
    { header: "Spent type", key: "spentType", width: 18 },
    { header: "Note", key: "note", width: 30 },
  ];
  styleHeaderRow(detailsSheet);

  let detailsTotal = 0;
  for (const e of expenses) {
    detailsTotal += e.amount;
    detailsSheet.addRow({
      date: fmtIstDate(e.date),
      description: e.description,
      amount: e.amount,
      paymentType: e.paymentType,
      doneBy: e.doneBy,
      toName: e.toName,
      vendor: e.vendor,
      spentType: e.spentType,
      note: e.note ?? "",
    });
  }
  // Trailing total row so the finance reviewer can SUM check at a
  // glance. Highlighted so it doesn't get mistaken for data.
  if (expenses.length > 0) {
    const totalRow = detailsSheet.addRow({
      description: "TOTAL",
      amount: detailsTotal,
    });
    totalRow.font = TOTAL_ROW_FONT;
    totalRow.fill = TOTAL_ROW_FILL;
  }
  detailsSheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: detailsSheet.columns.length },
  };

  // 2. By Person sheet — aggregate by doneBy. We do the grouping in
  // memory because the dataset is tiny (months have at most a few
  // hundred expense rows). For larger volumes we'd push this into
  // a SQL GROUP BY instead.
  const byPersonSheet = wb.addWorksheet("By Person");
  byPersonSheet.columns = [
    { header: "Done by", key: "doneBy", width: 20 },
    { header: "Entries", key: "count", width: 10 },
    { header: "Total spent (₹)", key: "total", width: 16 },
    { header: "Avg per entry (₹)", key: "avg", width: 18 },
  ];
  styleHeaderRow(byPersonSheet);

  type Agg = { count: number; total: number };
  const byPerson = new Map<string, Agg>();
  for (const e of expenses) {
    const key = e.doneBy?.trim() || "(blank)";
    const cur = byPerson.get(key) ?? { count: 0, total: 0 };
    cur.count += 1;
    cur.total += e.amount;
    byPerson.set(key, cur);
  }
  // Sort by total descending — biggest spenders at the top.
  const sorted = [...byPerson.entries()].sort(
    ([, a], [, b]) => b.total - a.total,
  );
  for (const [doneBy, agg] of sorted) {
    byPersonSheet.addRow({
      doneBy,
      count: agg.count,
      total: agg.total,
      avg: agg.count > 0 ? Math.round(agg.total / agg.count) : 0,
    });
  }
  // Footer total row mirroring the Details sheet.
  if (sorted.length > 0) {
    const grandTotal = sorted.reduce((s, [, a]) => s + a.total, 0);
    const grandCount = sorted.reduce((s, [, a]) => s + a.count, 0);
    const totalRow = byPersonSheet.addRow({
      doneBy: "TOTAL",
      count: grandCount,
      total: grandTotal,
      avg: grandCount > 0 ? Math.round(grandTotal / grandCount) : 0,
    });
    totalRow.font = TOTAL_ROW_FONT;
    totalRow.fill = TOTAL_ROW_FILL;
  }

  // ─── Output ────────────────────────────────────────────────────
  const ab = await wb.xlsx.writeBuffer();
  const bytes = Buffer.from(ab);
  return { filename: opts.filename, bytes };
}

// ─── Local helpers ────────────────────────────────────────────────

function fmtIstDate(d: Date): string {
  return d.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function styleHeaderRow(sheet: ExcelJS.Worksheet): void {
  const headerRow = sheet.getRow(1);
  headerRow.font = HEADER_FONT;
  headerRow.fill = HEADER_FILL;
  headerRow.alignment = { vertical: "middle", horizontal: "left" };
  headerRow.height = 22;
}
