"use server";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireSuperadmin } from "@/lib/admin-auth";
import {
  monthlyInterest,
  monthRange,
  isExpenseGap,
  operatingMarginPct,
  toGranularity,
  type LoanTerms,
  type PnlColumn,
  type PnlFunding,
  type PnlGranularity,
  type PnlResult,
} from "@/lib/pnl-math";

/**
 * The Overall P&L — one Screener-style statement for the whole business.
 *
 * Every other analytics surface answers a slice: Sports answers "what did
 * the turf earn", Cafe answers "what did the kitchen earn", Expenses
 * answers "where did money go". None of them ever subtract one from the
 * other, so nothing in the admin has, until now, answered "did we make
 * money last month".
 *
 * ── Accounting model (decided 2026-09-01, keep it or change it knowingly)
 *
 * CASH BASIS, matching the rest of the money story. Income is money
 * received in the period; expenses are money spent in the period.
 *
 *  income  = bookings + passes + tournaments + camps + cafe   (all GROSS)
 *  expense = Expense(module=RUNNING) only
 *  operating profit = income − expense
 *  interest = simple interest on the founder loan (CapitalContribution)
 *  net profit = operating profit − interest
 *
 * Two traps this deliberately avoids:
 *
 * 1. Cafe is counted GROSS and its stock cost is left to flow through the
 *    RUNNING "Inventory" expense rows, which is where it is actually
 *    recorded (₹26k of water, cold drinks, chips, bread and patties as of
 *    Sept 2026). The cafe dashboard separately computes profit from
 *    CafeItem.costPrice — subtracting THAT here as well would count the
 *    same cost twice. costPrice is a per-item margin tool, not a cash
 *    figure, and it moves retroactively when an item is re-priced.
 *
 * 2. Expense(module=GENERAL) — the ₹50L Jan-Jun 2026 build-out — is NOT an
 *    operating cost and never enters these rows. It is capex. It shows up
 *    only in the funding/payback block, where it belongs. Putting it in
 *    the table would drown six months of margin under a one-off.
 *
 * Bookings are bucketed by PLAY DATE (Booking.date) while passes,
 * tournaments and camps bucket by PAID time, because that is exactly what
 * getMonthlyEarningsForYear does. The reconciliation with the Sports tab
 * matters more than internal purity here — if these two ever disagree,
 * someone will trust the wrong one.
 */

const EARNING_BOOKING_STATUSES_SQL = Prisma.join([
  "CONFIRMED",
  "COMPLETED",
  "ABSENT",
]);

// Mirrors VALID_STATUSES in actions/admin-cafe-analytics.ts. PENDING_PAYMENT
// is excluded: the gateway has not confirmed, so no money exists yet.
const CAFE_STATUSES_SQL = Prisma.join([
  "PENDING",
  "PREPARING",
  "READY",
  "COMPLETED",
]);

/** IST is UTC+5:30; Postgres timestamps are UTC. */
const IST_SHIFT = Prisma.sql`interval '330 minutes'`;

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function labelFor(key: string, granularity: PnlGranularity): string {
  if (granularity === "year") return `FY ${key}`;
  const [y, m] = key.split("-").map(Number);
  const name = new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-IN", {
    month: "short",
    timeZone: "UTC",
  });
  return `${name} ${y}`;
}

type Bucket = { key: string; amount: number };

export async function getProfitAndLoss(
  granularity: PnlGranularity = "month",
): Promise<
  { success: true; data: PnlResult } | { success: false; error: string }
> {
  // Superadmin only. This is the one screen that puts rent, salaries,
  // total profit and the owners' own capital on a single page — a
  // strictly higher bar than the per-permission VIEW_ANALYTICS gate the
  // other analytics tabs use.
  await requireSuperadmin();

  try {
    // ── Income, one query per stream, all keyed to an IST month ───────
    const [
      bookingRows,
      passRows,
      tournamentRows,
      campRows,
      cafeRows,
      expenseRows,
      contributions,
      capexAgg,
    ] = await Promise.all([
      // Bookings, net of pass-covered slots: the pass sale was already
      // counted as income when it was bought, so a covered slot is ₹0
      // here rather than revenue recognised twice.
      db.$queryRaw<Bucket[]>(Prisma.sql`
        SELECT to_char(b.date, 'YYYY-MM') AS key,
               SUM(b."totalAmount" - COALESCE(pr.covered, 0))::bigint AS amount
        FROM "Booking" b
        LEFT JOIN (
          SELECT "bookingId", SUM("coveredAmount") AS covered
          FROM "PassRedemption"
          WHERE "restoredAt" IS NULL
          GROUP BY "bookingId"
        ) pr ON pr."bookingId" = b.id
        WHERE b.status IN (${EARNING_BOOKING_STATUSES_SQL})
        GROUP BY key
      `),
      db.$queryRaw<Bucket[]>(Prisma.sql`
        SELECT to_char(up."purchasedAt" + ${IST_SHIFT}, 'YYYY-MM') AS key,
               SUM(up.price)::bigint AS amount
        FROM "UserPass" up
        WHERE up.price > 0
        GROUP BY key
      `),
      // Team entry fees AND third-party venue hire. A THIRD_PARTY
      // tournament takes nothing from teams, so without the second leg
      // an organiser-funded month reads as zero tournament revenue.
      db.$queryRaw<Bucket[]>(Prisma.sql`
        SELECT key, SUM(amount)::bigint AS amount FROM (
          SELECT to_char(tt."paidAt" + ${IST_SHIFT}, 'YYYY-MM') AS key,
                 tt."paidAmount" AS amount
          FROM "TournamentTeam" tt
          WHERE tt."paidAmount" > 0
            AND tt."archivedAt" IS NULL
            AND tt.status = 'CONFIRMED'
            AND tt."paidAt" IS NOT NULL
          UNION ALL
          SELECT to_char(op."receivedAt" + ${IST_SHIFT}, 'YYYY-MM') AS key,
                 op."amount" AS amount
          FROM "TournamentOrganizerPayment" op
          WHERE op."amount" > 0
        ) t
        GROUP BY key
      `),
      db.$queryRaw<Bucket[]>(Prisma.sql`
        SELECT to_char(cr."paidAt" + ${IST_SHIFT}, 'YYYY-MM') AS key,
               SUM(cr."paidAmount")::bigint AS amount
        FROM "CampRegistration" cr
        WHERE cr."paidAmount" > 0
          AND cr."archivedAt" IS NULL
          AND cr.status = 'CONFIRMED'
          AND cr."paidAt" IS NOT NULL
        GROUP BY key
      `),
      // Cafe GROSS. totalAmount is rupees (CafePayment is paise; this
      // column is not — see the unit note in admin-analytics.ts).
      db.$queryRaw<Bucket[]>(Prisma.sql`
        SELECT to_char(co."createdAt" + ${IST_SHIFT}, 'YYYY-MM') AS key,
               SUM(co."totalAmount")::bigint AS amount
        FROM "CafeOrder" co
        WHERE co.status IN (${CAFE_STATUSES_SQL})
        GROUP BY key
      `),
      // RUNNING only. Expense.date is a DATE — already the calendar day
      // that was typed in, so no timezone shift applies.
      db.$queryRaw<{ key: string; category: string; amount: bigint }[]>(
        Prisma.sql`
          SELECT to_char(e.date, 'YYYY-MM') AS key,
                 e."spentType" AS category,
                 SUM(e.amount)::bigint AS amount
          FROM "Expense" e
          WHERE e.module = 'RUNNING'
          GROUP BY key, category
        `,
      ),
      db.capitalContribution.findMany({ orderBy: [{ kind: "asc" }, { name: "asc" }] }),
      db.expense.aggregate({
        where: { module: "GENERAL" },
        _sum: { amount: true },
      }),
    ]);

    // ── Build the period axis ────────────────────────────────────────
    const allMonthKeys = new Set<string>();
    for (const r of [
      ...bookingRows,
      ...passRows,
      ...tournamentRows,
      ...campRows,
      ...cafeRows,
    ]) {
      if (r.key) allMonthKeys.add(r.key);
    }
    for (const r of expenseRows) if (r.key) allMonthKeys.add(r.key);

    if (allMonthKeys.size === 0) {
      return {
        success: true,
        data: {
          periods: [],
          columns: [],
          expenseCategories: [],
          funding: emptyFunding(contributions, capexAgg._sum.amount ?? 0),
        },
      };
    }

    // Fill every month between the first and the current one, so a quiet
    // month is a zero column rather than a gap the eye skips over.
    const sorted = [...allMonthKeys].sort();
    const first = sorted[0];
    const now = new Date();
    const lastKey = monthKey(now);
    // Run to today, or past it if a row is dated in the future — a
    // forward-dated expense must still get a column to live in.
    const latest = sorted[sorted.length - 1];
    const months = monthRange(first, lastKey > latest ? lastKey : latest);

    const periodKeys: string[] = [];
    const monthsPerPeriod = new Map<string, number>();
    for (const m of months) {
      const k = toGranularity(m, granularity);
      if (!monthsPerPeriod.has(k)) {
        monthsPerPeriod.set(k, 0);
        periodKeys.push(k);
      }
      monthsPerPeriod.set(k, (monthsPerPeriod.get(k) ?? 0) + 1);
    }

    // ── Fold every stream into its column ────────────────────────────
    const blank = (): PnlColumn => ({
      key: "",
      bookings: 0,
      passes: 0,
      tournaments: 0,
      camps: 0,
      cafe: 0,
      totalIncome: 0,
      expenseByCategory: {},
      totalExpenses: 0,
      operatingProfit: 0,
      opmPct: null,
      interest: 0,
      netProfit: 0,
      expensesUntracked: false,
    });

    const cols = new Map<string, PnlColumn>();
    for (const k of periodKeys) cols.set(k, { ...blank(), key: k });

    const addStream = (rows: Bucket[], field: keyof PnlColumn) => {
      for (const r of rows) {
        if (!r.key) continue;
        const col = cols.get(toGranularity(r.key, granularity));
        if (!col) continue;
        (col[field] as number) += Number(r.amount);
      }
    };
    addStream(bookingRows, "bookings");
    addStream(passRows, "passes");
    addStream(tournamentRows, "tournaments");
    addStream(campRows, "camps");
    addStream(cafeRows, "cafe");

    const categoryTotals = new Map<string, number>();
    for (const r of expenseRows) {
      if (!r.key) continue;
      const col = cols.get(toGranularity(r.key, granularity));
      if (!col) continue;
      const amt = Number(r.amount);
      const cat = r.category || "Uncategorised";
      col.expenseByCategory[cat] = (col.expenseByCategory[cat] ?? 0) + amt;
      col.totalExpenses += amt;
      categoryTotals.set(cat, (categoryTotals.get(cat) ?? 0) + amt);
    }

    // ── Interest on the founder loan ─────────────────────────────────
    // Simple interest, charged per operating month, only for months on or
    // after the loan's startDate. A yearly column charges the months it
    // actually contains, so a part-year is not billed a full year.
    const loans = contributions.filter((c) => c.kind === "LOAN");
    const loanTerms: LoanTerms[] = loans.map((l) => ({
      amount: l.amount,
      ratePct: l.ratePct,
      startMonth: monthKey(l.startDate),
    }));
    for (const m of months) {
      const col = cols.get(toGranularity(m, granularity));
      if (col) col.interest += monthlyInterest(loanTerms, m);
    }

    // The month operating-expense tracking began. Before it, an
    // expense-free month is the build-out, not an omission.
    const expenseMonths = expenseRows.map((r) => r.key).filter(Boolean).sort();
    const firstExpensePeriod =
      expenseMonths.length > 0
        ? toGranularity(expenseMonths[0], granularity)
        : null;

    const columns = periodKeys.map((k) => {
      const c = cols.get(k)!;
      c.totalIncome =
        c.bookings + c.passes + c.tournaments + c.camps + c.cafe;
      c.operatingProfit = c.totalIncome - c.totalExpenses;
      c.opmPct = operatingMarginPct(c.totalIncome, c.operatingProfit);
      c.interest = Math.round(c.interest);
      c.netProfit = c.operatingProfit - c.interest;
      c.expensesUntracked = isExpenseGap(
        c.key,
        firstExpensePeriod,
        c.totalIncome,
        c.totalExpenses,
      );
      return c;
    });

    const equity = contributions
      .filter((c) => c.kind === "EQUITY")
      .map((c) => ({ name: c.name, amount: c.amount }));
    const equityTotal = equity.reduce((s, e) => s + e.amount, 0);
    const loanRows = loans.map((l) => ({
      name: l.name,
      amount: l.amount,
      ratePct: l.ratePct,
      from: monthKey(l.startDate),
    }));
    const loanTotal = loanRows.reduce((s, l) => s + l.amount, 0);
    const capexRecorded = capexAgg._sum.amount ?? 0;
    const cumulativeNetProfit = columns.reduce((s, c) => s + c.netProfit, 0);

    return {
      success: true,
      data: {
        periods: periodKeys.map((k) => ({
          key: k,
          label: labelFor(k, granularity),
          months: monthsPerPeriod.get(k) ?? 1,
        })),
        columns,
        expenseCategories: [...categoryTotals.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([c]) => c),
        funding: {
          equity,
          equityTotal,
          loans: loanRows,
          loanTotal,
          fundingTotal: equityTotal + loanTotal,
          capexRecorded,
          fundingGap: equityTotal + loanTotal - capexRecorded,
          cumulativeNetProfit,
          paybackRemaining:
            capexRecorded > 0
              ? Math.max(0, capexRecorded - cumulativeNetProfit)
              : null,
        },
      },
    };
  } catch (error) {
    console.error("getProfitAndLoss error:", error);
    return { success: false, error: "Failed to build the P&L" };
  }
}

function emptyFunding(
  contributions: { name: string; kind: string; amount: number; ratePct: number; startDate: Date }[],
  capexRecorded: number,
): PnlFunding {
  const equity = contributions
    .filter((c) => c.kind === "EQUITY")
    .map((c) => ({ name: c.name, amount: c.amount }));
  const equityTotal = equity.reduce((s, e) => s + e.amount, 0);
  const loans = contributions
    .filter((c) => c.kind === "LOAN")
    .map((l) => ({
      name: l.name,
      amount: l.amount,
      ratePct: l.ratePct,
      from: monthKey(l.startDate),
    }));
  const loanTotal = loans.reduce((s, l) => s + l.amount, 0);
  return {
    equity,
    equityTotal,
    loans,
    loanTotal,
    fundingTotal: equityTotal + loanTotal,
    capexRecorded,
    fundingGap: equityTotal + loanTotal - capexRecorded,
    cumulativeNetProfit: 0,
    paybackRemaining: capexRecorded > 0 ? capexRecorded : null,
  };
}
