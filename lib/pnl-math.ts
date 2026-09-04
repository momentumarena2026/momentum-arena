/**
 * Pure arithmetic behind the Overall P&L.
 *
 * Split out of actions/admin-pnl.ts so the money maths can be tested
 * without a database. Everything here is deterministic: no clock, no
 * Prisma, no IST conversion (the SQL already bucketed rows into IST
 * month keys before anything in this file sees them).
 */

export type PnlGranularity = "month" | "year";

/** A loan as the P&L needs it: principal, annual rate, first charged month. */
export type LoanTerms = {
  amount: number;
  ratePct: number;
  /** "YYYY-MM" — interest is charged from this month onward, inclusive. */
  startMonth: string;
};

/** "2026-07" → "2026" when showing years; unchanged when showing months. */
export function toGranularity(
  monthKey: string,
  granularity: PnlGranularity,
): string {
  return granularity === "year" ? monthKey.slice(0, 4) : monthKey;
}

/**
 * Simple interest for ONE month across every loan already drawn.
 *
 * Simple, not compounding, and never capitalised into the principal:
 * this is a founder loan tracked on the same cash basis as the rest of
 * the money story, not a bank amortisation schedule. A loan that has not
 * started yet contributes nothing rather than accruing silently.
 */
export function monthlyInterest(loans: LoanTerms[], monthKey: string): number {
  let total = 0;
  for (const l of loans) {
    if (l.startMonth > monthKey) continue;
    total += (l.amount * (l.ratePct / 100)) / 12;
  }
  return total;
}

/**
 * Every month from `first` to `last` inclusive, so a quiet month renders
 * as a zero column instead of a gap the eye skips over. Both bounds are
 * "YYYY-MM"; a `last` before `first` yields just `first`.
 */
export function monthRange(first: string, last: string): string[] {
  const [fy, fm] = first.split("-").map(Number);
  const out: string[] = [];
  let y = fy;
  let m = fm;
  for (let guard = 0; guard < 1200; guard++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(key);
    if (key >= last) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * Operating margin as a whole percent, or null when there was no income
 * to divide by. Null rather than 0 on purpose: a month with no income and
 * ₹40k of rent has an undefined margin, not a 0% one, and rendering "0%"
 * there reads as break-even.
 */
export function operatingMarginPct(
  totalIncome: number,
  operatingProfit: number,
): number | null {
  if (totalIncome <= 0) return null;
  return Math.round((operatingProfit / totalIncome) * 100);
}

/**
 * Should a column be marked as "income with no expenses behind it"?
 *
 * True ONLY for a period at or after operating-expense tracking began.
 * Before that, the arena was being built and every cost was capitalised
 * into Expense(GENERAL), so an expense-free month is correct accounting
 * and its revenue is operating profit in full — not something to warn
 * about. After tracking began, the same shape means somebody stopped
 * entering expenses, and an unflagged 100% margin would be believed.
 *
 * `firstTrackedPeriod` is null when no running expense exists at all, in
 * which case nothing is ever flagged.
 */
export function isExpenseGap(
  periodKey: string,
  firstTrackedPeriod: string | null,
  totalIncome: number,
  totalExpenses: number,
): boolean {
  if (firstTrackedPeriod === null) return false;
  if (periodKey < firstTrackedPeriod) return false;
  return totalIncome > 0 && totalExpenses === 0;
}

/**
 * ── Shapes returned by getProfitAndLoss.
 *
 * These live HERE and not in actions/admin-pnl.ts on purpose. That file
 * carries "use server", and a type export from a server-action module
 * broke every admin tournaments page on 2026-08-2x while `tsc` reported
 * zero errors — the build strips the module to its async exports and the
 * re-export becomes a runtime import of nothing. Types belong in a plain
 * module both sides can import.
 */
export type PnlPeriod = {
  /** "2026-07" for months, "2026" for years. Sort key and map key. */
  key: string;
  /** "Jul 2026" / "FY 2026" — what the column header shows. */
  label: string;
  /** Months of real activity in this column; drives the interest charge. */
  months: number;
};

export type PnlColumn = {
  key: string;
  bookings: number;
  passes: number;
  tournaments: number;
  camps: number;
  cafe: number;
  totalIncome: number;
  /** spentType → rupees, only categories with spend in the window. */
  expenseByCategory: Record<string, number>;
  totalExpenses: number;
  operatingProfit: number;
  /** Operating margin %, null when there was no income to divide by. */
  opmPct: number | null;
  interest: number;
  netProfit: number;
  /**
   * Customer refunds paid out in the period. A MEMO figure — deliberately
   * NOT part of totalExpenses, operatingProfit or netProfit.
   *
   * A cancellation is a full reversal: the booking drops out of income
   * (the query filters to CONFIRMED/COMPLETED/ABSENT), so charging the
   * refund as an expense would bill the business for money it never
   * booked — ₹0 in, ₹500 out, a ₹500 "loss" on a transaction that netted
   * zero. Owner's ruling, 2026-09-02.
   *
   * It is still shown, because /admin/running-expenses counts refunds in
   * its total. Without this row the two screens disagree by exactly this
   * amount and nothing on either says why.
   */
  refunds: number;
  /**
   * Income in this period, no RUNNING expense recorded, AND the period
   * falls on or after operating-expense tracking began.
   *
   * The last clause is the whole point. Months BEFORE the first RUNNING
   * expense (Apr-Jun 2026) are not suspicious: the arena was still being
   * built and every cost was being capitalised into Expense(GENERAL), so
   * revenue earned then really is operating profit with nothing to
   * subtract. Owner's call, 2026-09-02, and it is the correct one.
   *
   * A gap AFTER tracking started is a different animal — it means
   * somebody stopped entering expenses, and the column would quietly
   * read as a 100% margin. That is what this flags.
   */
  expensesUntracked: boolean;
};

export type PnlFunding = {
  equity: { name: string; amount: number }[];
  equityTotal: number;
  loans: { name: string; amount: number; ratePct: number; from: string }[];
  loanTotal: number;
  fundingTotal: number;
  /** Expense(GENERAL) total — what the build-out actually cost. */
  capexRecorded: number;
  /** fundingTotal − capexRecorded. Non-zero = something is unrecorded. */
  fundingGap: number;
  /** Net profit summed across every period shown. */
  cumulativeNetProfit: number;
  /** Capex still to earn back. Null when there is no capex recorded. */
  paybackRemaining: number | null;
};

export type PnlResult = {
  periods: PnlPeriod[];
  columns: PnlColumn[];
  /** Union of every spentType present, ordered by total spend desc. */
  expenseCategories: string[];
  funding: PnlFunding;
};
