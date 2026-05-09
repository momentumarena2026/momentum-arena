import ExcelJS from "exceljs";
import { fetchSettlementReconForMonth } from "@/lib/razorpay-api";
import type { RzpReconRow } from "@/lib/razorpay-api";

/**
 * Razorpay settlement reconciliation report.
 *
 * Mirrors the column shape of Razorpay dashboard's "Download
 * Settlement Report" XLSX so the finance team can use it
 * interchangeably. We pull every line item that hit a settlement
 * in the requested calendar month and lay them out 1:1.
 *
 * Amounts come back from Razorpay in paise — we divide by 100 in
 * the sheet so the cells are rupees and Excel SUMs the way you'd
 * expect.
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export async function generateRazorpayReconReport(input: {
  year: number;
  month: number; // 1-12
}): Promise<{ filename: string; bytes: Buffer }> {
  const rows = await fetchSettlementReconForMonth(input.year, input.month);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Momentum Arena admin";
  wb.created = new Date();

  // ── Summary sheet ────────────────────────────────────────────
  // Quick-scan totals so the admin doesn't have to SUM the raw
  // sheet to know "what landed in our bank this month".
  const summary = wb.addWorksheet("Summary");
  summary.addRow([`Razorpay settlement recon — ${MONTHS[input.month - 1]} ${input.year}`]);
  summary.lastRow!.font = { bold: true, size: 14 };
  summary.addRow([]);

  const stats = computeReconSummary(rows);
  const summaryHeader = summary.addRow(["Metric", "Value"]);
  styleHeader(summaryHeader);

  summary.addRow(["Total line items", rows.length]);
  summary.addRow(["Payments captured (₹)", stats.paymentsAmount]);
  summary.addRow(["Refunds processed (₹)", stats.refundsAmount]);
  summary.addRow(["Adjustments (₹)", stats.adjustmentsAmount]);
  summary.addRow(["Razorpay fees (₹)", stats.feesAmount]);
  summary.addRow(["GST on fees (₹)", stats.taxAmount]);
  summary.addRow(["Net settled to bank (₹)", stats.netSettled]);
  summary.addRow([]);
  summary.addRow(["Distinct settlements", stats.settlementIds.size]);
  summary.addRow(["Settlement IDs", [...stats.settlementIds].join(", ") || "—"]);

  summary.getColumn(1).width = 30;
  summary.getColumn(2).width = 60;

  // ── Recon line items sheet ───────────────────────────────────
  // 1:1 with the Razorpay dashboard export. Same column order so
  // file-vs-file diffs are trivial.
  const recon = wb.addWorksheet("Recon line items");
  recon.columns = [
    { header: "Entity ID", key: "entity_id", width: 22 },
    { header: "Type", key: "type", width: 12 },
    { header: "Debit (₹)", key: "debit", width: 12 },
    { header: "Credit (₹)", key: "credit", width: 12 },
    { header: "Amount (₹)", key: "amount", width: 12 },
    { header: "Currency", key: "currency", width: 10 },
    { header: "Fee (₹)", key: "fee", width: 10 },
    { header: "Tax (₹)", key: "tax", width: 10 },
    { header: "On hold", key: "on_hold", width: 8 },
    { header: "Settled", key: "settled", width: 8 },
    { header: "Settlement ID", key: "settlement_id", width: 22 },
    { header: "Settlement UTR", key: "utr", width: 22 },
    { header: "Created at", key: "created_at", width: 20 },
    { header: "Settled at", key: "settled_at", width: 20 },
    { header: "Posted at", key: "posted_at", width: 20 },
    { header: "Credit type", key: "credit_type", width: 12 },
    { header: "Payment ID", key: "payment_id", width: 22 },
    { header: "Order ID", key: "order_id", width: 22 },
    { header: "Order receipt", key: "order_receipt", width: 22 },
    { header: "Method", key: "method", width: 12 },
    { header: "Card network", key: "card_network", width: 14 },
    { header: "Card issuer", key: "card_issuer", width: 14 },
    { header: "Card type", key: "card_type", width: 12 },
    { header: "Dispute ID", key: "dispute_id", width: 22 },
    { header: "Bank", key: "bank", width: 14 },
    { header: "Email", key: "email", width: 28 },
    { header: "Contact", key: "contact", width: 16 },
    { header: "Transfer ID", key: "transfer_id", width: 22 },
    { header: "International", key: "international", width: 12 },
    { header: "Description", key: "description", width: 28 },
    { header: "Notes", key: "notes", width: 28 },
  ];
  styleHeader(recon.getRow(1));

  for (const r of rows) {
    recon.addRow({
      entity_id: r.entity_id,
      type: r.type,
      // Paise → rupees so SUMs in Excel are useful directly.
      debit: paiseToRupees(r.debit),
      credit: paiseToRupees(r.credit),
      amount: paiseToRupees(r.amount),
      currency: r.currency,
      fee: paiseToRupees(r.fee),
      tax: paiseToRupees(r.tax),
      on_hold: r.on_hold ? "Yes" : "No",
      settled: r.settled ? "Yes" : "No",
      settlement_id: r.settlement_id ?? "",
      // The recon row doesn't carry UTR directly — it's on the
      // Settlement entity. Leaving blank here keeps the column
      // shape stable; admins resolve via settlement_id +
      // /admin/razorpay if needed.
      utr: "",
      created_at: fmtRzpTs(r.created_at),
      settled_at: fmtRzpTs(r.settled_at),
      posted_at: fmtRzpTs(r.posted_at),
      credit_type: r.credit_type ?? "",
      payment_id: r.payment_id ?? "",
      order_id: r.order_id ?? "",
      order_receipt: r.order_receipt ?? "",
      method: r.method ?? "",
      card_network: r.card_network ?? "",
      card_issuer: r.card_issuer ?? "",
      card_type: r.card_type ?? "",
      dispute_id: r.dispute_id ?? "",
      bank: r.bank ?? "",
      email: r.email ?? "",
      contact: r.contact ?? "",
      transfer_id: r.transfer_id ?? "",
      international: r.international == null ? "" : r.international ? "Yes" : "No",
      description: r.description ?? "",
      notes: r.notes ? JSON.stringify(r.notes) : "",
    });
  }

  recon.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: recon.columns.length },
  };

  const ab = await wb.xlsx.writeBuffer();
  const bytes = Buffer.from(ab);
  const yyyy = String(input.year).padStart(4, "0");
  const mm = String(input.month).padStart(2, "0");
  const filename = `momentum-arena_${yyyy}-${mm}_razorpay-recon.xlsx`;
  return { filename, bytes };
}

// ─── Helpers ──────────────────────────────────────────────────────

interface ReconSummary {
  paymentsAmount: number;
  refundsAmount: number;
  adjustmentsAmount: number;
  feesAmount: number;
  taxAmount: number;
  netSettled: number;
  settlementIds: Set<string>;
}

function computeReconSummary(rows: RzpReconRow[]): ReconSummary {
  const out: ReconSummary = {
    paymentsAmount: 0,
    refundsAmount: 0,
    adjustmentsAmount: 0,
    feesAmount: 0,
    taxAmount: 0,
    netSettled: 0,
    settlementIds: new Set(),
  };
  for (const r of rows) {
    const amount = paiseToRupees(r.amount);
    if (r.type === "payment") out.paymentsAmount += amount;
    else if (r.type === "refund") out.refundsAmount += amount;
    else if (r.type === "adjustment") out.adjustmentsAmount += amount;
    out.feesAmount += paiseToRupees(r.fee);
    out.taxAmount += paiseToRupees(r.tax);
    // Razorpay's recon: credit increases bank settlement, debit
    // reduces it. Net settled = sum(credit) - sum(debit), in rupees.
    out.netSettled += paiseToRupees(r.credit) - paiseToRupees(r.debit);
    if (r.settlement_id) out.settlementIds.add(r.settlement_id);
  }
  return out;
}

function paiseToRupees(paise: number): number {
  return Math.round(paise) / 100;
}

function fmtRzpTs(epochSec: number | null | undefined): string {
  if (!epochSec) return "";
  return new Date(epochSec * 1000).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function styleHeader(row: ExcelJS.Row): void {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF10B981" },
  };
  row.alignment = { vertical: "middle", horizontal: "left" };
}
