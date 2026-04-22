// One-off: seed Expense rows + ExpenseOption rows from /expenses.csv.
//
// This mirrors the raw "Playing Zone Mathura Expenses" sheet the founders
// were keeping in Google Sheets. The CSV columns are:
//   Date, Sub (description), Amount, Type (payment type),
//   Done By, To (immediate recipient), Vendor (money-attribution bucket),
//   Spent Type (category)
//
// We:
//   1. Parse all rows (with naive quote-aware CSV split).
//   2. Derive distinct values for each dropdown and bulk-upsert them
//      into ExpenseOption with sensible sortOrder increments.
//   3. Insert Expense rows with matching ExpenseEditHistory entries
//      (editType CREATED, adminId null because this isn't a user action).
//
// Idempotency: the script refuses to run if any Expense rows already
// exist — we only want this to fire once against a clean table.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { PrismaClient } = require("@prisma/client");

const CSV_PATH = path.join(__dirname, "..", "expenses.csv");

// ---------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------

function parseCsv(text) {
  // Small quote-aware splitter — handles quoted fields containing commas
  // (e.g. the Date column "Jan 26, 2026") but assumes no embedded
  // newlines or escaped quotes. Fine for this file.
  const rows = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    const fields = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (c === "," && !inQuotes) {
        fields.push(current);
        current = "";
        continue;
      }
      current += c;
    }
    fields.push(current);
    rows.push(fields.map((f) => f.trim()));
  }
  return rows;
}

function parseDate(s) {
  // "Jan 26, 2026" → UTC midnight on that calendar day.
  const d = new Date(s + " UTC");
  if (isNaN(d.getTime())) {
    // Fallback for any odd local formats.
    const alt = new Date(s);
    if (isNaN(alt.getTime())) throw new Error(`Unparseable date: ${s}`);
    return alt;
  }
  return d;
}

function parseAmount(s) {
  const n = parseInt(String(s).replace(/[,\s]/g, ""), 10);
  if (!Number.isFinite(n) || n <= 0)
    throw new Error(`Unparseable amount: ${s}`);
  return n;
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------

async function main() {
  const csvText = fs.readFileSync(CSV_PATH, "utf8");
  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    console.log("[skip] CSV empty");
    return;
  }

  // Header: Date, Sub, Amount = 4167977, Type, Done By, To, Vendor, Spent Type
  const [, ...dataRows] = rows;
  const parsed = dataRows.map((cols, i) => {
    try {
      return {
        date: parseDate(cols[0]),
        description: cols[1],
        amount: parseAmount(cols[2]),
        paymentType: cols[3],
        doneBy: cols[4],
        toName: cols[5],
        vendor: cols[6],
        spentType: cols[7],
      };
    } catch (err) {
      throw new Error(`Row ${i + 2}: ${err.message} — ${JSON.stringify(cols)}`);
    }
  });

  console.log(`[parse] ${parsed.length} rows parsed`);

  const p = new PrismaClient();

  const existingCount = await p.expense.count();
  if (existingCount > 0) {
    console.log(
      `[abort] refusing to import — ${existingCount} Expense rows already exist`
    );
    await p.$disconnect();
    return;
  }

  // Seed ExpenseOption rows from the distinct values so admins can
  // manage dropdowns without retyping.
  const distinct = {
    PAYMENT_TYPE: new Set(),
    DONE_BY: new Set(),
    VENDOR: new Set(),
    SPENT_TYPE: new Set(),
    TO_NAME: new Set(),
  };
  for (const r of parsed) {
    distinct.PAYMENT_TYPE.add(r.paymentType);
    distinct.DONE_BY.add(r.doneBy);
    distinct.VENDOR.add(r.vendor);
    distinct.SPENT_TYPE.add(r.spentType);
    distinct.TO_NAME.add(r.toName);
  }

  const optionRecords = [];
  for (const [field, set] of Object.entries(distinct)) {
    const labels = Array.from(set).sort((a, b) => a.localeCompare(b));
    labels.forEach((label, i) => {
      optionRecords.push({
        id: crypto.randomUUID(),
        field,
        label,
        isActive: true,
        sortOrder: (i + 1) * 10,
      });
    });
  }

  await p.expenseOption.createMany({
    data: optionRecords,
    skipDuplicates: true,
  });
  console.log(`[seed] ${optionRecords.length} ExpenseOption rows`);

  // Batch-insert Expense rows then their CREATED history entries.
  // Postgres parameter limit (~65k) is well beyond what we need for 215
  // rows so a single createMany call is fine.
  const expenseRecords = parsed.map((r) => ({
    id: crypto.randomUUID(),
    date: r.date,
    description: r.description,
    amount: r.amount,
    paymentType: r.paymentType,
    doneBy: r.doneBy,
    toName: r.toName,
    vendor: r.vendor,
    spentType: r.spentType,
    note: null,
    createdByAdminId: null,
  }));

  await p.expense.createMany({ data: expenseRecords });
  console.log(`[insert] ${expenseRecords.length} Expense rows`);

  const historyRecords = expenseRecords.map((e) => ({
    id: crypto.randomUUID(),
    expenseId: e.id,
    adminId: null,
    adminUsername: "CSV Import",
    editType: "CREATED",
    changes: [],
    note: "Imported from expenses.csv seed",
  }));

  await p.expenseEditHistory.createMany({ data: historyRecords });
  console.log(`[insert] ${historyRecords.length} ExpenseEditHistory rows`);

  const sum = expenseRecords.reduce((acc, r) => acc + r.amount, 0);
  console.log(`[done] imported — total ₹${sum.toLocaleString("en-IN")}`);

  await p.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
