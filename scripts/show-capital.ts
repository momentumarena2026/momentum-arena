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

  // Who actually paid for the build-out and the running costs. This is
  // the real record of who put money in — the capital rows should agree
  // with it, and the whole reason the seeded flat 7L was wrong is that
  // nobody ever compared the two.
  const spend = await db.expense.groupBy({
    by: ["doneBy", "module"],
    _sum: { amount: true },
    _count: true,
  });
  const byPerson = new Map<string, { general: number; running: number; n: number }>();
  for (const r of spend) {
    const cur = byPerson.get(r.doneBy) ?? { general: 0, running: 0, n: 0 };
    if (r.module === "GENERAL") cur.general += r._sum.amount ?? 0;
    else cur.running += r._sum.amount ?? 0;
    cur.n += r._count;
    byPerson.set(r.doneBy, cur);
  }
  console.log("");
  console.log("Who spent (Expense.doneBy):");
  console.log("   name          capex(GENERAL)      running        total    rows");
  for (const [name, v] of [...byPerson.entries()].sort(
    (a, b) => b[1].general + b[1].running - (a[1].general + a[1].running),
  )) {
    const tot = v.general + v.running;
    console.log(
      `   ${name.padEnd(20)} ₹${v.general.toLocaleString("en-IN").padStart(12)} ` +
        `₹${v.running.toLocaleString("en-IN").padStart(12)} ₹${tot.toLocaleString("en-IN").padStart(12)}  ${v.n}`,
    );
  }

  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
