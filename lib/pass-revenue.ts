import { Prisma } from "@prisma/client";

/**
 * Which pass sales count as revenue.
 *
 * ONE definition, because this is counted in nine places — the revenue
 * chart, the KPI tiles, the sport breakdown, the monthly and daily
 * earnings, the P&L and the CA report — and a cancelled pass that is
 * excluded from eight of them is worse than one excluded from none: the
 * totals disagree and nobody can tell which is right.
 *
 * The repo has been bitten by exactly this before; it is gotcha #1 in
 * PROJECT-CONTEXT, where adding a revenue stream to three of four
 * surfaces made the numbers silently disagree. The rule lives here so
 * adding a condition means editing one line.
 *
 * `price > 0` excludes comps and prize passes, which were never a sale.
 * `status <> CANCELLED` excludes a sale that has been reversed.
 */
export const SOLD_PASS_WHERE = {
  price: { gt: 0 },
  status: { not: "CANCELLED" },
} as const;

/** The same rule for the raw-SQL sites, which alias UserPass as `up`. */
export const SOLD_PASS_SQL = Prisma.sql`up.price > 0 AND up.status <> 'CANCELLED'`;

/**
 * The same rule where the row is being listed rather than summed — the CA
 * report prints every sale, including comps, so only the reversal applies.
 */
export const UNCANCELLED_PASS_WHERE = {
  status: { not: "CANCELLED" },
} as const;
