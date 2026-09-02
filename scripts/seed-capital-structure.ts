// One-shot: record how the build-out was funded, so the Overall P&L can
// charge interest and show payback without hardcoding anyone's money.
//
// As stated by the owner on 2026-09-01:
//   ₹7,00,000 equity each from Nakul, Anand and Utkarsh
//   the remainder is a loan from Nakul at 12% p.a.
//
// The loan principal is DERIVED from the recorded capex rather than
// typed in: it is whatever Expense(module=GENERAL) totals, minus the
// ₹21L of equity. That way the funding side always reconciles with the
// spend side, and re-running after a late capex row lands corrects the
// loan instead of silently leaving a gap. As of writing, GENERAL totals
// ₹50,06,332 → a ₹29,06,332 loan.
//
// startDate = the first month with RUNNING expenses (the arena's first
// operating month, July 2026). Interest is charged from there, not from
// the capex months: Jan–Jun 2026 had no revenue to charge it against,
// and billing it there would bury six months of P&L under a cost the
// business could not yet have paid. Edit the row if the real draw
// schedule differs — the P&L reads whatever is in the table.
//
// Idempotent: keyed on (name, kind), so re-running updates amounts in
// place rather than stacking duplicate contributions.
//
// Usage (production):
//   DATABASE_URL=$PRODUCTION_DB_URL npx tsx scripts/seed-capital-structure.ts
//
// Or via .github/workflows/seed-capital-structure.yml (workflow_dispatch).

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const EQUITY_PER_FOUNDER = 700_000;
const FOUNDERS = ["Nakul", "Anand", "Utkarsh"] as const;
const LOAN_FROM = "Nakul";
const LOAN_RATE_PCT = 12;

async function main() {
  const capex = await db.expense.aggregate({
    where: { module: "GENERAL" },
    _sum: { amount: true },
  });
  const capexTotal = capex._sum.amount ?? 0;

  const equityTotal = EQUITY_PER_FOUNDER * FOUNDERS.length;
  const loanPrincipal = Math.max(0, capexTotal - equityTotal);

  // First operating month = earliest RUNNING expense. Falls back to the
  // first of the current month if nothing is recorded yet, which only
  // happens on an empty staging DB.
  const firstRunning = await db.expense.findFirst({
    where: { module: "RUNNING" },
    orderBy: { date: "asc" },
    select: { date: true },
  });
  const d = firstRunning?.date ?? new Date();
  const startDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

  console.log(`Capex recorded (GENERAL): ₹${capexTotal.toLocaleString("en-IN")}`);
  console.log(`Equity (${FOUNDERS.length} × ₹${EQUITY_PER_FOUNDER.toLocaleString("en-IN")}): ₹${equityTotal.toLocaleString("en-IN")}`);
  console.log(`Loan from ${LOAN_FROM} @ ${LOAN_RATE_PCT}%: ₹${loanPrincipal.toLocaleString("en-IN")}`);
  console.log(`Interest accrues from: ${startDate.toISOString().slice(0, 10)}`);

  for (const name of FOUNDERS) {
    const existing = await db.capitalContribution.findFirst({
      where: { name, kind: "EQUITY" },
    });
    if (existing) {
      await db.capitalContribution.update({
        where: { id: existing.id },
        data: { amount: EQUITY_PER_FOUNDER, startDate },
      });
      console.log(`  updated equity: ${name}`);
    } else {
      await db.capitalContribution.create({
        data: {
          name,
          kind: "EQUITY",
          amount: EQUITY_PER_FOUNDER,
          startDate,
          note: "Founder equity contribution to the build-out",
        },
      });
      console.log(`  created equity: ${name}`);
    }
  }

  const existingLoan = await db.capitalContribution.findFirst({
    where: { name: LOAN_FROM, kind: "LOAN" },
  });
  if (existingLoan) {
    await db.capitalContribution.update({
      where: { id: existingLoan.id },
      data: { amount: loanPrincipal, ratePct: LOAN_RATE_PCT, startDate },
    });
    console.log(`  updated loan: ${LOAN_FROM}`);
  } else {
    await db.capitalContribution.create({
      data: {
        name: LOAN_FROM,
        kind: "LOAN",
        amount: loanPrincipal,
        ratePct: LOAN_RATE_PCT,
        startDate,
        note: "Balance of the build-out funded as a founder loan",
      },
    });
    console.log(`  created loan: ${LOAN_FROM}`);
  }

  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
