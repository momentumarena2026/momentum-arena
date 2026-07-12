import ExcelJS from "exceljs";
import { db } from "@/lib/db";

/**
 * CA cafe item-sales report — the chartered accountant's month-wise
 * cafe filing. Deliberately minimal: exactly three data columns.
 *
 *   Item name | Total qty sold | Total price (₹)
 *
 * Aggregated from CafeOrderItem LINE SNAPSHOTS (itemName + totalPrice
 * captured at order time), not the live CafeItem table — so menu items
 * that were renamed or deleted after the sale still report under the
 * name and price the customer actually paid.
 *
 * Excluded order statuses: CANCELLED + PENDING_PAYMENT — the same
 * VALID_STATUSES filter the cafe analytics dashboard and the
 * CAFE_INVENTORY reports use, so all three reconcile.
 *
 * Note for the reader: totals are GROSS line values. Order-level
 * coupon discounts live on CafeOrder.discountAmount and can't be
 * apportioned per item; the CA's net figure comes from the sales /
 * CA monthly report, this one explains the per-item mix.
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
  fgColor: { argb: "FF1F2937" },
};
const TOTAL_ROW_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
};

const VALID_STATUSES = ["PENDING", "PREPARING", "READY", "COMPLETED"] as const;

export async function generateCafeItemSalesMonthlyReport(input: {
  year: number;
  month: number;
}): Promise<{ filename: string; bytes: Buffer }> {
  const monthStart = new Date(Date.UTC(input.year, input.month - 1, 1));
  const monthEnd = new Date(Date.UTC(input.year, input.month, 1));
  const yyyy = String(input.year).padStart(4, "0");
  const mm = String(input.month).padStart(2, "0");

  const lines = await db.cafeOrderItem.findMany({
    where: {
      order: {
        createdAt: { gte: monthStart, lt: monthEnd },
        status: { in: [...VALID_STATUSES] },
      },
    },
    select: { itemName: true, quantity: true, totalPrice: true },
  });

  // Aggregate by the snapshotted item name. In-memory like the sibling
  // cafe-inventory worker — menu cardinality is small.
  const agg = new Map<string, { qty: number; total: number }>();
  for (const l of lines) {
    const cur = agg.get(l.itemName) ?? { qty: 0, total: 0 };
    cur.qty += l.quantity;
    cur.total += l.totalPrice;
    agg.set(l.itemName, cur);
  }

  const rows = [...agg.entries()]
    .map(([name, a]) => ({ name, qty: a.qty, total: a.total }))
    .sort((a, b) => {
      if (b.qty !== a.qty) return b.qty - a.qty;
      return a.name.localeCompare(b.name);
    });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Momentum Arena";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Cafe item sales");
  sheet.columns = [
    { header: "Item name", key: "name", width: 34 },
    { header: "Total qty sold", key: "qty", width: 16 },
    { header: "Total price (₹)", key: "total", width: 18 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle", horizontal: "left" };
  });
  headerRow.height = 22;

  for (const r of rows) {
    const row = sheet.addRow({
      name: r.name,
      qty: r.qty,
      // Round to paise so Float dust (0.1+0.2 style) never reaches the CA.
      total: Math.round(r.total * 100) / 100,
    });
    row.getCell("total").numFmt = "#,##0.00";
  }

  if (rows.length > 0) {
    const totalRow = sheet.addRow({
      name: "TOTALS",
      qty: rows.reduce((s, r) => s + r.qty, 0),
      total:
        Math.round(rows.reduce((s, r) => s + r.total, 0) * 100) / 100,
    });
    totalRow.getCell("total").numFmt = "#,##0.00";
    totalRow.eachCell((cell) => {
      cell.fill = TOTAL_ROW_FILL;
      cell.font = TOTAL_ROW_FONT;
    });
  }

  sheet.views = [{ state: "frozen", ySplit: 1 }];

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  const bytes = Buffer.from(arrayBuffer);
  return {
    filename: `momentum-arena_${yyyy}-${mm}_cafe-item-sales.xlsx`,
    bytes,
  };
}
