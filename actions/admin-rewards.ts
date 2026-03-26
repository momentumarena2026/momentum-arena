"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin as requireAdminBase } from "@/lib/admin-auth";
import { getOrCreateRewardConfig, getOrCreateBalance, recalculateTier } from "@/lib/reward-points";

async function requireAdmin() {
  const user = await requireAdminBase();
  return user.id;
}

/**
 * Get the full reward config for admin editing.
 */
export async function getAdminRewardConfig() {
  await requireAdmin();
  const config = await getOrCreateRewardConfig();
  return {
    id: config.id,
    sportsEarnRate: config.sportsEarnRate,
    cafeEarnRate: config.cafeEarnRate,
    referralBonus: config.referralBonus,
    pointsPerRupee: config.pointsPerRupee,
    minRedeemPoints: config.minRedeemPoints,
    maxRedeemPercent: config.maxRedeemPercent,
    silverThreshold: config.silverThreshold,
    goldThreshold: config.goldThreshold,
    platinumThreshold: config.platinumThreshold,
    bronzeMultiplier: config.bronzeMultiplier,
    silverMultiplier: config.silverMultiplier,
    goldMultiplier: config.goldMultiplier,
    platinumMultiplier: config.platinumMultiplier,
    pointsExpiryDays: config.pointsExpiryDays,
  };
}

const configSchema = z.object({
  sportsEarnRate: z.number().int().min(0),
  cafeEarnRate: z.number().int().min(0),
  referralBonus: z.number().int().min(0),
  pointsPerRupee: z.number().int().min(1),
  minRedeemPoints: z.number().int().min(0),
  maxRedeemPercent: z.number().int().min(0).max(10000),
  silverThreshold: z.number().int().min(1),
  goldThreshold: z.number().int().min(1),
  platinumThreshold: z.number().int().min(1),
  bronzeMultiplier: z.number().int().min(10000),
  silverMultiplier: z.number().int().min(10000),
  goldMultiplier: z.number().int().min(10000),
  platinumMultiplier: z.number().int().min(10000),
  pointsExpiryDays: z.number().int().min(0),
});

/**
 * Update all reward config fields.
 */
export async function updateRewardConfig(data: z.infer<typeof configSchema>) {
  await requireAdmin();

  const parsed = configSchema.safeParse(data);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Invalid data",
    };
  }

  // Validate tier thresholds are in ascending order
  if (
    parsed.data.silverThreshold >= parsed.data.goldThreshold ||
    parsed.data.goldThreshold >= parsed.data.platinumThreshold
  ) {
    return {
      success: false,
      error: "Tier thresholds must be in ascending order: Silver < Gold < Platinum",
    };
  }

  const config = await getOrCreateRewardConfig();
  await db.rewardConfig.update({
    where: { id: config.id },
    data: parsed.data,
  });

  return { success: true };
}

/**
 * Search users by name or email, return with their reward balance.
 */
export async function searchUserPoints(query: string) {
  await requireAdmin();

  if (!query || query.trim().length < 2) {
    return { success: false, error: "Query must be at least 2 characters", users: [] };
  }

  const users = await db.user.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { email: { contains: query, mode: "insensitive" } },
        { phone: { contains: query } },
      ],
    },
    include: {
      rewardBalance: {
        include: {
          transactions: {
            orderBy: { createdAt: "desc" },
            take: 10,
          },
        },
      },
    },
    take: 20,
  });

  return {
    success: true,
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      balance: u.rewardBalance
        ? {
            currentBalance: u.rewardBalance.currentBalance,
            totalEarned: u.rewardBalance.totalEarned,
            totalRedeemed: u.rewardBalance.totalRedeemed,
            tier: u.rewardBalance.tier,
            transactions: u.rewardBalance.transactions.map((t) => ({
              id: t.id,
              type: t.type,
              points: t.points,
              description: t.description,
              createdAt: t.createdAt.toISOString(),
            })),
          }
        : null,
    })),
  };
}

/**
 * Manually adjust a user's points (positive or negative).
 */
export async function adjustUserPoints(
  userId: string,
  points: number,
  description: string
) {
  await requireAdmin();

  if (!points || points === 0) {
    return { success: false, error: "Points must be non-zero" };
  }
  if (!description || description.trim().length < 3) {
    return { success: false, error: "Description is required" };
  }

  const config = await getOrCreateRewardConfig();
  const balance = await getOrCreateBalance(userId);

  // For negative adjustments, ensure balance won't go below 0
  if (points < 0 && balance.currentBalance + points < 0) {
    return {
      success: false,
      error: `Cannot reduce by ${Math.abs(points)} points. User only has ${balance.currentBalance} points.`,
    };
  }

  await db.$transaction(async (tx) => {
    await tx.pointsTransaction.create({
      data: {
        balanceId: balance.id,
        userId,
        type: "ADJUSTMENT",
        points,
        description: description.trim(),
      },
    });

    const updateData: Record<string, unknown> = {
      currentBalance: { increment: points },
    };

    if (points > 0) {
      updateData.totalEarned = { increment: points };
      // Recalculate tier for positive adjustments
      const newTier = recalculateTier(balance.totalEarned + points, config);
      updateData.tier = newTier;
    } else {
      updateData.totalRedeemed = { increment: Math.abs(points) };
    }

    await tx.rewardPointsBalance.update({
      where: { id: balance.id },
      data: updateData,
    });
  });

  return { success: true };
}

/**
 * Get overall reward system stats for admin dashboard.
 */
export async function getRewardStats() {
  await requireAdmin();

  const [
    totalBalances,
    tierDistribution,
    topEarners,
  ] = await Promise.all([
    db.rewardPointsBalance.aggregate({
      _sum: {
        currentBalance: true,
        totalEarned: true,
        totalRedeemed: true,
      },
      _count: true,
    }),
    db.rewardPointsBalance.groupBy({
      by: ["tier"],
      _count: true,
    }),
    db.rewardPointsBalance.findMany({
      orderBy: { totalEarned: "desc" },
      take: 10,
      include: {
        user: { select: { name: true, email: true, phone: true } },
      },
    }),
  ]);

  return {
    totalPointsInCirculation: totalBalances._sum.currentBalance ?? 0,
    totalPointsEverEarned: totalBalances._sum.totalEarned ?? 0,
    totalPointsRedeemed: totalBalances._sum.totalRedeemed ?? 0,
    totalUsers: totalBalances._count,
    tierDistribution: tierDistribution.map((t) => ({
      tier: t.tier,
      count: t._count,
    })),
    topEarners: topEarners.map((e) => ({
      userId: e.userId,
      name: e.user.name,
      email: e.user.email,
      phone: e.user.phone,
      totalEarned: e.totalEarned,
      currentBalance: e.currentBalance,
      tier: e.tier,
    })),
  };
}
