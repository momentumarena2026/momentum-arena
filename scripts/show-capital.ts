/** Read-only: what the capital structure and the P&L currently say. */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

async function main() {
  const rows = await db.capitalContribution.findMany({
    orderBy: [{ kind: "asc" }, { name: "asc" }],
  });
  console.log("CapitalContribution rows:");
  for (const r of rows) {
    console.log(
      `   ${r.name.padEnd(10)} ${r.kind.padEnd(7)} ₹${r.amount.toLocaleString("en-IN").padStart(12)}` +
        `  rate=${r.ratePct}%  from=${r.startDate.toISOString().slice(0, 10)}` +
        `  ${r.note ? `note="${r.note}"` : ""}`,
    );
  }
  const eq = rows.filter((r) => r.kind === "EQUITY").reduce((a, r) => a + r.amount, 0);
  const ln = rows.filter((r) => r.kind === "LOAN").reduce((a, r) => a + r.amount, 0);
  console.log("");
  console.log(`   equity total ₹${eq.toLocaleString("en-IN")}`);
  console.log(`   loan total   ₹${ln.toLocaleString("en-IN")}`);
  console.log(`   funding      ₹${(eq + ln).toLocaleString("en-IN")}`);

  const capex = await db.expense.aggregate({
    where: { module: "GENERAL" },
    _sum: { amount: true },
  });
  console.log(`   capex recorded (GENERAL) ₹${(capex._sum.amount ?? 0).toLocaleString("en-IN")}`);

  // Anything already recorded against these names on the expense side.
  const named = await db.expense.findMany({
    where: { OR: [{ toName: { in: ["Nakul", "Anand", "Utkarsh"] } }] },
    select: { date: true, amount: true, toName: true, module: true, spentType: true, notes: true },
    orderBy: { date: "asc" },
    take: 20,
  });
  console.log("");
  console.log(`Expense rows paid to a founder: ${named.length}`);
  for (const e of named) {
    console.log(
      `   ${e.date.toISOString().slice(0, 10)} ${String(e.toName).padEnd(9)} ₹${e.amount.toLocaleString("en-IN").padStart(10)}  ${e.module}/${e.spentType ?? "—"}  ${e.notes ?? ""}`,
    );
  }
  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
