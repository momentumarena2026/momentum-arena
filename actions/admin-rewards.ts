"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin as requireAdminBase } from "@/lib/admin-auth";
import {
  getRewardConfig,
  invalidateRewardConfigCache,
  pointsToPaise,
} from "@/lib/rewards/config";
import { readBalance } from "@/lib/rewards/balance";
import { adminGrantPoints } from "@/lib/rewards/earn";
import type { Sport } from "@prisma/client";

/**
 * Admin-side rewards server actions. All require the
 * MANAGE_REWARDS permission (or SUPERADMIN). Mirrors the structure of
 * actions/admin-user-groups.ts.
 */
async function requireAdmin() {
  const user = await requireAdminBase("MANAGE_REWARDS");
  return user.id;
}

// ─── Overview ────────────────────────────────────────────────────

export interface AdminRewardsOverview {
  totalUsersWithBalance: number;
  totalPointsOutstanding: number;
  totalPaiseOutstanding: number;
  pointsEarnedLast30d: number;
  pointsRedeemedLast30d: number;
  pointsExpiredLast30d: number;
  openAlerts: number;
  config: {
    enabled: boolean;
    earnRateBookingBps: number;
    earnRateCafeBps: number;
    pointValuePaise: number;
    minPointsToRedeem: number;
    maxRedemptionPctOfBill: number;
    pointExpiryMonths: number;
    earnToRedeemMinHours: number;
  };
}

export async function getAdminRewardsOverview(): Promise<AdminRewardsOverview> {
  await requireAdmin();

  const horizon = new Date();
  horizon.setUTCDate(horizon.getUTCDate() - 30);

  const [
    cfg,
    balanceAgg,
    balanceCount,
    earnAgg,
    redeemAgg,
    expireAgg,
    openAlerts,
  ] = await Promise.all([
    getRewardConfig(),
    db.rewardBalance.aggregate({ _sum: { pointsAvailable: true } }),
    db.rewardBalance.count({ where: { pointsAvailable: { gt: 0 } } }),
    db.rewardTransaction.aggregate({
      where: {
        type: {
          in: [
            "EARNED_BOOKING",
            "EARNED_BOOKING_REMAINDER",
            "EARNED_CAFE",
            "EARNED_SIGNUP",
            "EARNED_REFERRAL",
            "EARNED_BIRTHDAY",
            "EARNED_ADJUSTMENT",
          ],
        },
        createdAt: { gte: horizon },
      },
      _sum: { points: true },
    }),
    db.rewardTransaction.aggregate({
      where: {
        type: { in: ["REDEEMED_BOOKING", "REDEEMED_CAFE"] },
        createdAt: { gte: horizon },
      },
      _sum: { points: true },
    }),
    db.rewardTransaction.aggregate({
      where: { type: "EXPIRED", createdAt: { gte: horizon } },
      _sum: { points: true },
    }),
    db.rewardAlert.count({ where: { status: "OPEN" } }),
  ]);

  const outstanding = balanceAgg._sum.pointsAvailable ?? 0;
  return {
    totalUsersWithBalance: balanceCount,
    totalPointsOutstanding: outstanding,
    totalPaiseOutstanding: pointsToPaise(outstanding, cfg),
    pointsEarnedLast30d: earnAgg._sum.points ?? 0,
    // Redeem rows store negative points — Math.abs to display
    pointsRedeemedLast30d: Math.abs(redeemAgg._sum.points ?? 0),
    pointsExpiredLast30d: Math.abs(expireAgg._sum.points ?? 0),
    openAlerts,
    config: {
      enabled: cfg.enabled,
      earnRateBookingBps: cfg.earnRateBookingBps,
      earnRateCafeBps: cfg.earnRateCafeBps,
      pointValuePaise: cfg.pointValuePaise,
      minPointsToRedeem: cfg.minPointsToRedeem,
      maxRedemptionPctOfBill: cfg.maxRedemptionPctOfBill,
      pointExpiryMonths: cfg.pointExpiryMonths,
      earnToRedeemMinHours: cfg.earnToRedeemMinHours,
    },
  };
}

// ─── Config (full read for the edit form) ────────────────────────

export async function getAdminRewardConfigFull() {
  await requireAdmin();
  const cfg = await getRewardConfig();
  return {
    enabled: cfg.enabled,
    cafeEarnEnabled: cfg.cafeEarnEnabled,
    earnRateBookingBps: cfg.earnRateBookingBps,
    earnRateCafeBps: cfg.earnRateCafeBps,
    pointValuePaise: cfg.pointValuePaise,
    minPointsToRedeem: cfg.minPointsToRedeem,
    maxRedemptionPctOfBill: cfg.maxRedemptionPctOfBill,
    maxRedemptionPaisePerTxn: cfg.maxRedemptionPaisePerTxn,
    pointExpiryMonths: cfg.pointExpiryMonths,
    earnToRedeemMinHours: cfg.earnToRedeemMinHours,
    signupBonusPoints: cfg.signupBonusPoints,
    referralEarnerPoints: cfg.referralEarnerPoints,
    referralReferredPoints: cfg.referralReferredPoints,
    birthdayBonusPoints: cfg.birthdayBonusPoints,
    highVelocityEarnDailyThreshold: cfg.highVelocityEarnDailyThreshold,
    bulkRedemptionPaiseThreshold: cfg.bulkRedemptionPaiseThreshold,
    enabledSports: cfg.enabledSports as ("CRICKET" | "FOOTBALL" | "PICKLEBALL")[],
  };
}

export type AdminRewardConfigFull = Awaited<
  ReturnType<typeof getAdminRewardConfigFull>
>;

// ─── Config edit ─────────────────────────────────────────────────

const configSchema = z.object({
  enabled: z.boolean(),
  cafeEarnEnabled: z.boolean(),
  earnRateBookingBps: z.number().int().min(0).max(10000),
  earnRateCafeBps: z.number().int().min(0).max(10000),
  pointValuePaise: z.number().int().min(1).max(100000),
  minPointsToRedeem: z.number().int().min(0).max(1_000_000),
  // Float so admins can dial in fractional caps (2.5%, 12.5%, etc.)
  // without bumping the schema to bps everywhere. The redemption math
  // is float-safe (final paise number is floored).
  maxRedemptionPctOfBill: z.number().min(0).max(100),
  maxRedemptionPaisePerTxn: z.number().int().min(0).max(10_000_000),
  // 0 means "no expiry" — points never decay. RewardTransaction.
  // expiresAt is nullable in the schema, and earn.ts collapses
  // months=0 into expiresAt=null at insert time. Default stays at 12.
  pointExpiryMonths: z.number().int().min(0).max(120),
  earnToRedeemMinHours: z.number().int().min(0).max(24 * 365),
  signupBonusPoints: z.number().int().min(0).max(1_000_000),
  referralEarnerPoints: z.number().int().min(0).max(1_000_000),
  referralReferredPoints: z.number().int().min(0).max(1_000_000),
  birthdayBonusPoints: z.number().int().min(0).max(1_000_000),
  highVelocityEarnDailyThreshold: z.number().int().min(0).max(10_000_000),
  bulkRedemptionPaiseThreshold: z.number().int().min(0).max(100_000_000),
  enabledSports: z.array(z.enum(["CRICKET", "FOOTBALL", "PICKLEBALL"])),
});

export type AdminRewardConfigInput = z.infer<typeof configSchema>;

export async function updateAdminRewardConfig(input: AdminRewardConfigInput) {
  await requireAdmin();
  const parsed = configSchema.parse(input);
  await db.rewardConfig.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      ...parsed,
      enabledSports: parsed.enabledSports as Sport[],
    },
    update: { ...parsed, enabledSports: parsed.enabledSports as Sport[] },
  });
  invalidateRewardConfigCache();
  revalidatePath("/admin/rewards");
  return { ok: true };
}

// ─── Users search + grant ────────────────────────────────────────

export interface AdminUserBalanceRow {
  userId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  pointsAvailable: number;
  pointsLifetimeEarned: number;
  pointsLifetimeRedeemed: number;
  lastTransactionAt: string | null;
}

export async function searchUsersForRewards(args: {
  query?: string;
  limit?: number;
}): Promise<AdminUserBalanceRow[]> {
  await requireAdmin();
  const limit = Math.min(Math.max(args.limit ?? 25, 1), 100);
  const q = args.query?.trim();

  const users = await db.user.findMany({
    where: q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { phone: { contains: q } },
          ],
        }
      : undefined,
    take: limit,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      rewardBalance: {
        select: {
          pointsAvailable: true,
          pointsLifetimeEarned: true,
          pointsLifetimeRedeemed: true,
          lastTransactionAt: true,
        },
      },
    },
  });

  return users.map((u) => ({
    userId: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    pointsAvailable: u.rewardBalance?.pointsAvailable ?? 0,
    pointsLifetimeEarned: u.rewardBalance?.pointsLifetimeEarned ?? 0,
    pointsLifetimeRedeemed: u.rewardBalance?.pointsLifetimeRedeemed ?? 0,
    lastTransactionAt:
      u.rewardBalance?.lastTransactionAt?.toISOString() ?? null,
  }));
}

/**
 * Returns IDs (and a count) of every user matching the search query,
 * regardless of pagination. Drives the "Select all" button on the
 * /admin/rewards/distribute screen so an admin can grant points to
 * the entire customer base in one click rather than scrolling the
 * paginated table.
 *
 * Hard-capped at 10_000 IDs so a runaway query can't ship megabytes
 * of strings over the wire — well above any realistic single-venue
 * customer count, but bounded.
 */
export async function getAllMatchingUserIdsForRewards(args: {
  query?: string;
}): Promise<{ userIds: string[]; total: number; truncated: boolean }> {
  await requireAdmin();
  const q = args.query?.trim();
  const CAP = 10_000;

  const where = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { email: { contains: q, mode: "insensitive" as const } },
          { phone: { contains: q } },
        ],
      }
    : {};

  const [users, total] = await Promise.all([
    db.user.findMany({
      where,
      take: CAP,
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }),
    db.user.count({ where }),
  ]);

  return {
    userIds: users.map((u) => u.id),
    total,
    truncated: total > CAP,
  };
}

const grantSchema = z.object({
  // Bumped from 1000 to 10000 so "Select all matching" can hit the
  // full customer base in a single grant. Anything above 10k should
  // be done via a cron-driven bulk distribute (not yet implemented).
  userIds: z.array(z.string().min(1)).min(1).max(10_000),
  points: z.number().int().min(1).max(1_000_000),
  reason: z.string().min(3).max(500),
});

export type AdminGrantPointsInput = z.infer<typeof grantSchema>;

export async function adminBulkGrantPoints(input: AdminGrantPointsInput) {
  const adminId = await requireAdmin();
  const parsed = grantSchema.parse(input);
  let granted = 0;
  let skipped = 0;
  for (const userId of parsed.userIds) {
    const r = await adminGrantPoints({
      userId,
      points: parsed.points,
      actorAdminId: adminId,
      reason: parsed.reason,
    });
    if (r.awarded) granted++;
    else skipped++;
  }
  revalidatePath("/admin/rewards");
  return {
    granted,
    skipped,
    totalPointsAwarded: granted * parsed.points,
  };
}

// ─── User detail (for the Users tab drilldown) ───────────────────

export async function getUserRewardDetail(userId: string) {
  await requireAdmin();
  const [balance, recent, user] = await Promise.all([
    readBalance(userId),
    db.rewardTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, phone: true },
    }),
  ]);
  if (!user) return null;
  return {
    user,
    balance,
    transactions: recent.map((t) => ({
      id: t.id,
      type: t.type,
      points: t.points,
      pointsValuePaise: t.pointsValuePaise,
      bookingId: t.bookingId,
      cafeOrderId: t.cafeOrderId,
      reason: t.reason,
      actorAdminId: t.actorAdminId,
      createdAt: t.createdAt.toISOString(),
      expiresAt: t.expiresAt?.toISOString() ?? null,
    })),
  };
}

// ─── Transactions ledger ─────────────────────────────────────────

/**
 * Cross-user reward transactions ledger — the "transaction book" admins
 * use to reconcile earned + redeemed points. Supports:
 *   - Free-text search across user name / email / phone
 *   - Date range (createdAt) — inclusive start, exclusive end
 *   - Type multi-select (any subset of RewardTxnType)
 *   - Direction: credit (points > 0), debit (points < 0), or both
 *   - Source ID match (bookingId or cafeOrderId, exact-equal)
 *   - Admin actor (search by username on actorAdminId)
 *   - Pagination (cursor-style via skip/take, 50 rows default)
 *
 * Returns the matching rows + aggregate totals for the filtered set so
 * the UI footer can show "X credits, Y debits, net Z" without a second
 * round trip. The aggregates are computed over the WHOLE filter result
 * (not just the current page) — that's the whole point of reconciling.
 *
 * Hard-capped at 10_000 rows in the aggregate query to bound runtime.
 * Beyond that, the report-builder (REWARD_TXN_LEDGER_*) is the right
 * tool because it streams to disk via ExcelJS.
 */

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

const listLedgerSchema = z.object({
  query: z.string().trim().max(200).optional(),
  fromDate: z.string().optional(), // ISO yyyy-mm-dd (IST midnight assumed)
  toDate: z.string().optional(),
  types: z.array(z.enum(REWARD_TXN_TYPES_ALL)).optional(),
  direction: z.enum(["credit", "debit", "all"]).optional(),
  sourceId: z.string().trim().max(64).optional(),
  actorQuery: z.string().trim().max(120).optional(),
  /** Pre-resolved admin user IDs to filter rewardTransaction.actorAdminId
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

/** Resolve an admin search query → AdminUser IDs. Used by the
 *  ledger query to prefilter rewardTransaction rows by `actorAdminId`.
 *  Returns null when no query was supplied (caller should leave actor
 *  filter unset), and an empty array when the query matched nothing
 *  (caller should short-circuit to an empty result). */
export async function resolveActorAdminIds(
  query: string | undefined,
): Promise<string[] | null> {
  if (!query) return null;
  const matches = await db.adminUser.findMany({
    where: {
      OR: [
        { username: { contains: query, mode: "insensitive" } },
        { email: { contains: query, mode: "insensitive" } },
      ],
    },
    select: { id: true },
    take: 100,
  });
  return matches.map((m) => m.id);
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

const AGG_CAP = 10_000;

export async function listRewardTransactions(
  input: ListRewardTransactionsInput,
): Promise<AdminRewardTxnLedger> {
  await requireAdmin();
  const parsed = listLedgerSchema.parse(input);
  const page = parsed.page ?? 0;
  const pageSize = parsed.pageSize ?? 50;

  // Resolve actor query → admin user IDs upfront so the main query
  // can do a single indexed `actorAdminId IN (...)` lookup.
  if (parsed.actorQuery) {
    const ids = await resolveActorAdminIds(parsed.actorQuery);
    if (ids && ids.length === 0) {
      return emptyLedger(page, pageSize);
    }
    parsed.actorAdminIds = ids ?? undefined;
  }

  const where = buildRewardTxnWhere(parsed);

  const [rows, total, aggregateRows] = await Promise.all([
    db.rewardTransaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: page * pageSize,
      take: pageSize,
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true },
        },
      },
    }),
    db.rewardTransaction.count({ where }),
    // Pull up to AGG_CAP rows just for aggregate math. At our scale
    // (<10k rewards txns total even after years) this is fine. If the
    // ledger ever grows past that, swap to two `aggregate` calls
    // (one for credits, one for debits) — for now the single-pass
    // makes credit/debit counts trivial without extra round-trips.
    db.rewardTransaction.findMany({
      where,
      take: AGG_CAP,
      select: { points: true, pointsValuePaise: true },
    }),
  ]);

  // Resolve actorAdminId → AdminUser row for the current page only.
  // actorAdminId is a raw string FK (no Prisma relation) so we do
  // a follow-up findMany. Cheap at pageSize ≤ 200.
  const actorIds = Array.from(
    new Set(rows.map((r) => r.actorAdminId).filter((x): x is string => !!x)),
  );
  const actorMap = new Map<string, { id: string; username: string; email: string }>();
  if (actorIds.length > 0) {
    const actors = await db.adminUser.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, username: true, email: true },
    });
    for (const a of actors) actorMap.set(a.id, a);
  }

  let creditPoints = 0;
  let debitPoints = 0;
  let creditCount = 0;
  let debitCount = 0;
  let creditValuePaise = 0;
  let debitValuePaise = 0;
  for (const r of aggregateRows) {
    if (r.points > 0) {
      creditPoints += r.points;
      creditValuePaise += r.pointsValuePaise;
      creditCount++;
    } else if (r.points < 0) {
      debitPoints += Math.abs(r.points);
      debitValuePaise += r.pointsValuePaise;
      debitCount++;
    }
  }

  return {
    rows: rows.map((r) => ({
      id: r.id,
      type: r.type as RewardTxnTypeFilter,
      points: r.points,
      pointsValuePaise: r.pointsValuePaise,
      bookingId: r.bookingId,
      cafeOrderId: r.cafeOrderId,
      sourceTxnId: r.sourceTxnId,
      reason: r.reason,
      expiresAt: r.expiresAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      user: r.user,
      actor: r.actorAdminId ? (actorMap.get(r.actorAdminId) ?? { id: r.actorAdminId, username: "unknown", email: "" }) : null,
    })),
    total,
    page,
    pageSize,
    aggregates: {
      creditPoints,
      debitPoints,
      netPoints: creditPoints - debitPoints,
      creditCount,
      debitCount,
      creditValuePaise,
      debitValuePaise,
    },
    aggregateTruncated: total > AGG_CAP,
  };
}

function emptyLedger(page: number, pageSize: number): AdminRewardTxnLedger {
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

// ─── Alerts list / actions ───────────────────────────────────────

export async function listRewardAlerts(args?: {
  status?: "OPEN" | "DISMISSED" | "ACTIONED";
  limit?: number;
}) {
  await requireAdmin();
  const status = args?.status ?? "OPEN";
  const limit = Math.min(Math.max(args?.limit ?? 100, 1), 500);

  const rows = await db.rewardAlert.findMany({
    where: { status },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      user: { select: { id: true, name: true, email: true, phone: true } },
    },
  });

  return rows.map((a) => ({
    id: a.id,
    kind: a.kind,
    severity: a.severity,
    status: a.status,
    details: a.details,
    createdAt: a.createdAt.toISOString(),
    resolvedAt: a.resolvedAt?.toISOString() ?? null,
    resolution: a.resolution,
    user: a.user,
  }));
}

const alertUpdateSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["DISMISSED", "ACTIONED"]),
  resolution: z.string().max(500).optional(),
});

export async function updateRewardAlertStatus(
  input: z.infer<typeof alertUpdateSchema>,
) {
  const adminId = await requireAdmin();
  const parsed = alertUpdateSchema.parse(input);
  await db.rewardAlert.update({
    where: { id: parsed.id },
    data: {
      status: parsed.status,
      resolution: parsed.resolution ?? null,
      resolvedAt: new Date(),
      resolvedBy: adminId,
    },
  });
  revalidatePath("/admin/rewards");
  return { ok: true };
}

// ─── Analytics quick-stats (rich funnel lives on /admin/analytics) ─

export interface AdminRewardsAnalytics {
  dailyEarnLast30d: { date: string; points: number }[];
  dailyRedeemLast30d: { date: string; points: number }[];
  topEarners30d: {
    userId: string;
    name: string | null;
    points: number;
  }[];
}

export async function getAdminRewardsAnalytics(): Promise<AdminRewardsAnalytics> {
  await requireAdmin();
  const horizon = new Date();
  horizon.setUTCDate(horizon.getUTCDate() - 30);

  // Daily earn aggregation. Postgres can group via raw — using Prisma
  // groupBy on createdAt would need a truncate. Simpler: pull all rows
  // and bucket in JS since 30d of earn rows is tiny at our volume.
  const [earns, redeems, topEarnersRaw] = await Promise.all([
    db.rewardTransaction.findMany({
      where: {
        createdAt: { gte: horizon },
        type: {
          in: [
            "EARNED_BOOKING",
            "EARNED_BOOKING_REMAINDER",
            "EARNED_CAFE",
            "EARNED_SIGNUP",
            "EARNED_REFERRAL",
            "EARNED_BIRTHDAY",
            "EARNED_ADJUSTMENT",
          ],
        },
      },
      select: { createdAt: true, points: true, userId: true },
    }),
    db.rewardTransaction.findMany({
      where: {
        createdAt: { gte: horizon },
        type: { in: ["REDEEMED_BOOKING", "REDEEMED_CAFE"] },
      },
      select: { createdAt: true, points: true },
    }),
    db.rewardTransaction.groupBy({
      by: ["userId"],
      where: {
        createdAt: { gte: horizon },
        type: {
          in: [
            "EARNED_BOOKING",
            "EARNED_BOOKING_REMAINDER",
            "EARNED_CAFE",
            "EARNED_SIGNUP",
            "EARNED_REFERRAL",
            "EARNED_BIRTHDAY",
            "EARNED_ADJUSTMENT",
          ],
        },
      },
      _sum: { points: true },
      orderBy: { _sum: { points: "desc" } },
      take: 10,
    }),
  ]);

  function bucket(rows: { createdAt: Date; points: number }[]) {
    const map = new Map<string, number>();
    for (const r of rows) {
      const k = r.createdAt.toISOString().split("T")[0];
      map.set(k, (map.get(k) ?? 0) + Math.abs(r.points));
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, points]) => ({ date, points }));
  }

  const topEarnerIds = topEarnersRaw.map((g) => g.userId);
  const topUsers =
    topEarnerIds.length > 0
      ? await db.user.findMany({
          where: { id: { in: topEarnerIds } },
          select: { id: true, name: true },
        })
      : [];
  const nameMap = new Map(topUsers.map((u) => [u.id, u.name]));

  return {
    dailyEarnLast30d: bucket(earns),
    dailyRedeemLast30d: bucket(redeems),
    topEarners30d: topEarnersRaw.map((g) => ({
      userId: g.userId,
      name: nameMap.get(g.userId) ?? null,
      points: g._sum.points ?? 0,
    })),
  };
}
