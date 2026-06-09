import ExcelJS from "exceljs";
import { db } from "@/lib/db";

/**
 * Cafe inventory + sales report. Replicates the table at the
 * bottom of /admin/analytics/cafe verbatim — one row per CafeItem
 * with the calendar month's units sold, the cash / online split,
 * and current on-hand stock. So an admin who needs to share the
 * same view by email or hand to the accountant can download
 * exactly what they see on screen.
 *
 * Columns (in display order):
 *   Sr no. | Product ID | Product name | Description | Category |
 *   Units sold | Cash units | Online units | Left in stock
 *
 * Channel allocation matches the dashboard:
 *   - CASH                              → cashUnits
 *   - UPI_QR | RAZORPAY | PHONEPE       → onlineUnits
 *   - FREE / null / other               → counted in unitsSold only
 *
 * Excluded order statuses: CANCELLED + PENDING_PAYMENT — same
 * VALID_STATUSES filter the dashboard query uses, so the report
 * total reconciles with the live page.
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

export async function generateCafeInventoryMonthlyReport(input: {
  year: number;
  month: number;
}): Promise<{ filename: string; bytes: Buffer }> {
  const monthStart = new Date(Date.UTC(input.year, input.month - 1, 1));
  const monthEnd = new Date(Date.UTC(input.year, input.month, 1));
  const yyyy = String(input.year).padStart(4, "0");
  const mm = String(input.month).padStart(2, "0");

  // Pull every line in the month with its parent payment method,
  // and every CafeItem. Lines aggregate in memory because Prisma
  // groupBy can't group by a relation field; menu cardinality is
  // small so this stays cheap.
  const [lines, items] = await Promise.all([
    db.cafeOrderItem.findMany({
      where: {
        order: {
          createdAt: { gte: monthStart, lt: monthEnd },
          status: { in: [...VALID_STATUSES] },
        },
      },
      select: {
        cafeItemId: true,
        quantity: true,
        order: {
          select: { payment: { select: { method: true } } },
        },
      },
    }),
    db.cafeItem.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        category: true,
        quantity: true,
      },
    }),
  ]);

  const soldMap = new Map<string, number>();
  const cashMap = new Map<string, number>();
  const onlineMap = new Map<string, number>();
  for (const l of lines) {
    const id = l.cafeItemId;
    soldMap.set(id, (soldMap.get(id) ?? 0) + l.quantity);
    const method = l.order.payment?.method;
    if (method === "CASH") {
      cashMap.set(id, (cashMap.get(id) ?? 0) + l.quantity);
    } else if (
      method === "UPI_QR" ||
      method === "RAZORPAY" ||
      method === "PHONEPE"
    ) {
      onlineMap.set(id, (onlineMap.get(id) ?? 0) + l.quantity);
    }
  }

  const rows = items
    .map((i) => ({
      id: i.id,
      name: i.name,
      description: i.description ?? "",
      category: String(i.category),
      unitsSold: soldMap.get(i.id) ?? 0,
      cashUnits: cashMap.get(i.id) ?? 0,
      onlineUnits: onlineMap.get(i.id) ?? 0,
      stockLeft: i.quantity,
    }))
    .sort((a, b) => {
      if (b.unitsSold !== a.unitsSold) return b.unitsSold - a.unitsSold;
      return a.name.localeCompare(b.name);
    });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Momentum Arena";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Inventory & Sales");
  sheet.columns = [
    { header: "Sr no.", key: "sr", width: 8 },
    { header: "Product ID", key: "id", width: 28 },
    { header: "Product name", key: "name", width: 28 },
    { header: "Description", key: "description", width: 40 },
    { header: "Category", key: "category", width: 14 },
    { header: "Units sold", key: "unitsSold", width: 14 },
    { header: "Cash units", key: "cashUnits", width: 12 },
    { header: "Online units", key: "onlineUnits", width: 14 },
    { header: "Left in stock", key: "stockLeft", width: 16 },
  ];

  // Style the header row.
  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle", horizontal: "left" };
  });
  headerRow.height = 22;

  rows.forEach((r, i) => {
    sheet.addRow({
      sr: i + 1,
      id: r.id,
      name: r.name,
      description: r.description,
      category: r.category,
      unitsSold: r.unitsSold,
      cashUnits: r.cashUnits,
      onlineUnits: r.onlineUnits,
      // Kitchen-prepared items (null quantity) render as "—" so
      // a reader doesn't confuse them with zero stock.
      stockLeft: r.stockLeft === null ? "—" : r.stockLeft,
    });
  });

  // Totals row at the bottom — sums of the numeric columns; the
  // stock column doesn't sum meaningfully (mix of integers and
  // null kitchen-items) so left blank.
  if (rows.length > 0) {
    const totalRow = sheet.addRow({
      name: "TOTALS",
      unitsSold: rows.reduce((s, r) => s + r.unitsSold, 0),
      cashUnits: rows.reduce((s, r) => s + r.cashUnits, 0),
      onlineUnits: rows.reduce((s, r) => s + r.onlineUnits, 0),
    });
    totalRow.eachCell((cell) => {
      cell.fill = TOTAL_ROW_FILL;
      cell.font = TOTAL_ROW_FONT;
    });
  }

  // Freeze the header row so scrolling keeps it visible.
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  const bytes = Buffer.from(arrayBuffer);
  const filename = `momentum-arena_${yyyy}-${mm}_cafe-inventory.xlsx`;
  return { filename, bytes };
}
