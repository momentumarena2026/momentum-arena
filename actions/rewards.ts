"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getRewardConfig, pointsToPaise } from "@/lib/rewards/config";
import { previewRedemption } from "@/lib/rewards/redeem";
import { readBalance } from "@/lib/rewards/balance";

/**
 * Customer-side rewards server actions. Web call sites use the
 * NextAuth cookie; mobile routes pass `userIdOverride` from the
 * JWT-derived user (same pattern as actions/waitlist.ts).
 */

// ---------- Balance + meta ----------

export interface RewardOverview {
  pointsAvailable: number;
  pointsValuePaise: number;
  pointsLifetimeEarned: number;
  pointsLifetimeRedeemed: number;
  pointsLifetimeExpired: number;
  /** Points expiring in the next 30 days */
  expiringSoonPoints: number;
  /** Same value in paise so the UI doesn't re-multiply */
  expiringSoonPaise: number;
  /** Config snapshot for the UI to render "1 point = ₹1" etc */
  config: {
    pointValuePaise: number;
    minPointsToRedeem: number;
    maxRedemptionPctOfBill: number;
    maxRedemptionPaisePerTxn: number;
    earnToRedeemMinHours: number;
    enabled: boolean;
    earnRateBookingBps: number;
    earnRateCafeBps: number;
    cafeEarnEnabled: boolean;
  };
}

export async function getMyRewardOverview(
  userIdOverride?: string,
): Promise<RewardOverview | null> {
  const userId = userIdOverride ?? (await auth())?.user?.id;
  if (!userId) return null;

  const [balance, cfg] = await Promise.all([
    readBalance(userId),
    getRewardConfig(),
  ]);

  // "Expiring soon" = sum of points on EARNED rows with expiresAt
  // in the next 30 days, capped at pointsAvailable.
  const horizon = new Date();
  horizon.setUTCDate(horizon.getUTCDate() + 30);
  const expiringAgg = await db.rewardTransaction.aggregate({
    where: {
      userId,
      points: { gt: 0 },
      expiresAt: { gte: new Date(), lte: horizon },
    },
    _sum: { points: true },
  });
  const expiringSoonPoints = Math.min(
    balance.pointsAvailable,
    expiringAgg._sum.points ?? 0,
  );

  return {
    pointsAvailable: balance.pointsAvailable,
    pointsValuePaise: pointsToPaise(balance.pointsAvailable, cfg),
    pointsLifetimeEarned: balance.pointsLifetimeEarned,
    pointsLifetimeRedeemed: balance.pointsLifetimeRedeemed,
    pointsLifetimeExpired: balance.pointsLifetimeExpired,
    expiringSoonPoints,
    expiringSoonPaise: pointsToPaise(expiringSoonPoints, cfg),
    config: {
      pointValuePaise: cfg.pointValuePaise,
      minPointsToRedeem: cfg.minPointsToRedeem,
      maxRedemptionPctOfBill: cfg.maxRedemptionPctOfBill,
      maxRedemptionPaisePerTxn: cfg.maxRedemptionPaisePerTxn,
      earnToRedeemMinHours: cfg.earnToRedeemMinHours,
      enabled: cfg.enabled,
      earnRateBookingBps: cfg.earnRateBookingBps,
      earnRateCafeBps: cfg.earnRateCafeBps,
      cafeEarnEnabled: cfg.cafeEarnEnabled,
    },
  };
}

// ---------- Transactions (paginated) ----------

export interface RewardTxnRow {
  id: string;
  type: string;
  points: number;
  pointsValuePaise: number;
  bookingId: string | null;
  cafeOrderId: string | null;
  reason: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface MyTxnsResult {
  rows: RewardTxnRow[];
  hasMore: boolean;
  nextCursor: string | null;
}

export async function getMyRewardTransactions(
  args: {
    /** ISO datetime — return rows OLDER than this (createdAt < before). */
    before?: string;
    limit?: number;
  } = {},
  userIdOverride?: string,
): Promise<MyTxnsResult | null> {
  const userId = userIdOverride ?? (await auth())?.user?.id;
  if (!userId) return null;

  const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
  const rows = await db.rewardTransaction.findMany({
    where: {
      userId,
      ...(args.before ? { createdAt: { lt: new Date(args.before) } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;
  return {
    rows: sliced.map((r) => ({
      id: r.id,
      type: r.type,
      points: r.points,
      pointsValuePaise: r.pointsValuePaise,
      bookingId: r.bookingId,
      cafeOrderId: r.cafeOrderId,
      reason: r.reason,
      expiresAt: r.expiresAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    hasMore,
    nextCursor: hasMore
      ? sliced[sliced.length - 1].createdAt.toISOString()
      : null,
  };
}

// ---------- Redemption preview (for checkout) ----------

export async function getRedemptionPreview(
  args: { billPaise: number },
  userIdOverride?: string,
): Promise<{
  enabled: boolean;
  maxPoints: number;
  maxPaise: number;
  pointsAvailable: number;
  pointValuePaise: number;
  minPoints: number;
  blockedReason?: string;
} | null> {
  const userId = userIdOverride ?? (await auth())?.user?.id;
  if (!userId) return null;

  const [preview, balance, cfg] = await Promise.all([
    previewRedemption({ userId, billPaise: args.billPaise }),
    readBalance(userId),
    getRewardConfig(),
  ]);

  return {
    enabled: cfg.enabled,
    maxPoints: preview.maxPoints,
    maxPaise: preview.maxPaise,
    pointsAvailable: balance.pointsAvailable,
    pointValuePaise: cfg.pointValuePaise,
    minPoints: cfg.minPointsToRedeem,
    blockedReason: preview.blockedReason,
  };
}
