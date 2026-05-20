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
