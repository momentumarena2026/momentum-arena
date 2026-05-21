/**
 * Shared types + sync helpers for the admin rewards transaction
 * ledger. Lives outside `actions/admin-rewards.ts` because that
 * module is a `"use server"` file — every export there must be an
 * async function, so consts, sync helpers, and the shape interfaces
 * can't ship from it.
 *
 * The server actions in `actions/admin-rewards.ts`, the XLSX export
 * route, the report worker, and the mobile transactions endpoint
 * all import from this module so their filter semantics + return
 * shapes stay in lockstep.
 */

import { z } from "zod";

export const REWARD_TXN_TYPES_ALL = [
  "EARNED_BOOKING",
  "EARNED_BOOKING_REMAINDER",
  "EARNED_CAFE",
  "EARNED_SIGNUP",
  "EARNED_REFERRAL",
  "EARNED_BIRTHDAY",
  "EARNED_ADJUSTMENT",
  "ADJUSTMENT_REFUND",
  "REDEEMED_BOOKING",
  "REDEEMED_CAFE",
  "REVOKED",
  "EXPIRED",
  "ADJUSTMENT_DEBIT",
] as const;

export type RewardTxnTypeFilter = (typeof REWARD_TXN_TYPES_ALL)[number];

export const listLedgerSchema = z.object({
  query: z.string().trim().max(200).optional(),
  fromDate: z.string().optional(), // ISO yyyy-mm-dd (IST midnight assumed)
  toDate: z.string().optional(),
  types: z.array(z.enum(REWARD_TXN_TYPES_ALL)).optional(),
  direction: z.enum(["credit", "debit", "all"]).optional(),
  sourceId: z.string().trim().max(64).optional(),
  actorQuery: z.string().trim().max(120).optional(),
  /** Pre-resolved AdminUser IDs to filter rewardTransaction.actorAdminId
   *  against. Either listRewardTransactions resolves this from actorQuery
   *  before calling buildRewardTxnWhere, or the export route passes IDs
   *  directly. Not exposed in the public input shape. */
  actorAdminIds: z.array(z.string()).optional(),
  page: z.number().int().min(0).max(10_000).optional(),
  pageSize: z.number().int().min(1).max(200).optional(),
});

export type ListRewardTransactionsInput = z.infer<typeof listLedgerSchema>;

export interface AdminRewardTxnRow {
  id: string;
  type: RewardTxnTypeFilter;
  points: number;
  pointsValuePaise: number;
  bookingId: string | null;
  cafeOrderId: string | null;
  sourceTxnId: string | null;
  reason: string | null;
  expiresAt: string | null;
  createdAt: string;
  user: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
  };
  actor: {
    id: string;
    username: string;
    email: string;
  } | null;
}

export interface AdminRewardTxnLedger {
  rows: AdminRewardTxnRow[];
  total: number; // total rows matching filter (not just this page)
  page: number;
  pageSize: number;
  aggregates: {
    creditPoints: number; // sum of positive `points`
    debitPoints: number; // absolute sum of negative `points`
    netPoints: number; // credits − debits
    creditCount: number;
    debitCount: number;
    creditValuePaise: number;
    debitValuePaise: number;
  };
  /** True when aggregate totals were computed over a capped result.
   *  UI shows a "narrow your filters" hint when this is true. */
  aggregateTruncated: boolean;
}

/** Build the Prisma `where` clause from the parsed input. Shared with
 *  the CSV export route so both paths use identical filter semantics. */
export function buildRewardTxnWhere(input: ListRewardTransactionsInput) {
  const where: Record<string, unknown> = {};

  // Date range. fromDate is treated as IST 00:00 of that day, toDate
  // as the START of the NEXT day so the range is inclusive of toDate.
  // We convert to UTC by subtracting 5h30m (IST = UTC+5:30).
  if (input.fromDate || input.toDate) {
    const createdAt: { gte?: Date; lt?: Date } = {};
    if (input.fromDate) {
      const d = parseIstDate(input.fromDate);
      if (d) createdAt.gte = d;
    }
    if (input.toDate) {
      const d = parseIstDate(input.toDate);
      if (d) {
        const next = new Date(d);
        next.setUTCDate(next.getUTCDate() + 1);
        createdAt.lt = next;
      }
    }
    if (createdAt.gte || createdAt.lt) where.createdAt = createdAt;
  }

  if (input.types && input.types.length > 0) {
    where.type = { in: input.types };
  }

  if (input.direction === "credit") {
    where.points = { gt: 0 };
  } else if (input.direction === "debit") {
    where.points = { lt: 0 };
  }

  if (input.sourceId) {
    where.OR = [
      { bookingId: input.sourceId },
      { cafeOrderId: input.sourceId },
    ];
  }

  if (input.query) {
    const q = input.query;
    where.user = {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
      ],
    };
  }

  // actorAdminId is a raw string field (no Prisma relation), so the
  // caller resolves matching admin IDs into the where clause first
  // via resolveActorAdminIds() before calling this builder.
  if (input.actorAdminIds) {
    where.actorAdminId = { in: input.actorAdminIds };
  }

  return where;
}

/** Convert a yyyy-mm-dd string to a Date representing IST midnight of
 *  that day, returned as a UTC Date (offset by -5h30m). Returns null
 *  for malformed input. */
function parseIstDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // IST = UTC + 5:30, so IST midnight is UTC (previous day 18:30).
  const utc = Date.UTC(y, mo - 1, d, 0, 0, 0, 0);
  return new Date(utc - (5 * 60 + 30) * 60 * 1000);
}

export function emptyLedger(
  page: number,
  pageSize: number,
): AdminRewardTxnLedger {
  return {
    rows: [],
    total: 0,
    page,
    pageSize,
    aggregates: {
      creditPoints: 0,
      debitPoints: 0,
      netPoints: 0,
      creditCount: 0,
      debitCount: 0,
      creditValuePaise: 0,
      debitValuePaise: 0,
    },
    aggregateTruncated: false,
  };
}
