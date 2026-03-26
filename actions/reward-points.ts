"use server";

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import {
  getOrCreateRewardConfig,
  getOrCreateBalance,
  calculateEarnPoints,
  getTierMultiplier,
  recalculateTier,
  calculateRedeemValue,
} from "@/lib/reward-points";

/**
 * Earn points for a booking or cafe order.
 * Creates a transaction, updates balance, and recalculates tier.
 */
export async function earnPoints(
  userId: string,
  amountPaise: number,
  type: "booking" | "cafe",
  referenceId: string
) {
  const config = await getOrCreateRewardConfig();
  const balance = await getOrCreateBalance(userId);

  const earnRate =
    type === "booking" ? config.sportsEarnRate : config.cafeEarnRate;
  const tierMultiplier = getTierMultiplier(balance.tier, config);
  const points = calculateEarnPoints(amountPaise, earnRate, tierMultiplier);

  if (points <= 0) {
    return { success: true, pointsEarned: 0 };
  }

  const expiresAt =
    config.pointsExpiryDays > 0
      ? new Date(Date.now() + config.pointsExpiryDays * 86400000)
      : null;

  const transactionType =
    type === "booking" ? "EARNED_BOOKING" : "EARNED_CAFE";

  const result = await db.$transaction(async (tx) => {
    const transaction = await tx.pointsTransaction.create({
      data: {
        balanceId: balance.id,
        userId,
        type: transactionType,
        points,
        description: `Earned from ${type === "booking" ? "sports booking" : "cafe order"}`,
        bookingId: type === "booking" ? referenceId : null,
        cafeOrderId: type === "cafe" ? referenceId : null,
        expiresAt,
      },
    });

    const newTotalEarned = balance.totalEarned + points;
    const newTier = recalculateTier(newTotalEarned, config);

    const updatedBalance = await tx.rewardPointsBalance.update({
      where: { id: balance.id },
      data: {
        totalEarned: { increment: points },
        currentBalance: { increment: points },
        tier: newTier,
      },
    });

    return { transaction, updatedBalance };
  });

  return {
    success: true,
    pointsEarned: points,
    newBalance: result.updatedBalance.currentBalance,
    newTier: result.updatedBalance.tier,
  };
}

/**
 * Redeem points for a booking or cafe order.
 * Validates balance, creates negative transaction, updates balance.
 * Returns the paise value of redeemed points.
 */
export async function redeemPoints(
  userId: string,
  points: number,
  type: "booking" | "cafe",
  referenceId: string
) {
  if (points <= 0) {
    return { success: false, error: "Points must be positive" };
  }

  const config = await getOrCreateRewardConfig();
  const balance = await getOrCreateBalance(userId);

  if (balance.currentBalance < points) {
    return { success: false, error: "Insufficient points balance" };
  }

  if (points < config.minRedeemPoints) {
    return {
      success: false,
      error: `Minimum ${config.minRedeemPoints} points required to redeem`,
    };
  }

  const redeemedPaise = calculateRedeemValue(points, config);
  const transactionType =
    type === "booking" ? "REDEEMED_BOOKING" : "REDEEMED_CAFE";

  await db.$transaction(async (tx) => {
    await tx.pointsTransaction.create({
      data: {
        balanceId: balance.id,
        userId,
        type: transactionType,
        points: -points,
        description: `Redeemed for ${type === "booking" ? "sports booking" : "cafe order"}`,
        bookingId: type === "booking" ? referenceId : null,
        cafeOrderId: type === "cafe" ? referenceId : null,
      },
    });

    await tx.rewardPointsBalance.update({
      where: { id: balance.id },
      data: {
        totalRedeemed: { increment: points },
        currentBalance: { decrement: points },
      },
    });
  });

  return { success: true, redeemedPaise, pointsUsed: points };
}

/**
 * Get the current user's reward balance, tier, and recent transactions.
 */
export async function getMyRewardBalance() {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  const balance = await getOrCreateBalance(session.user.id);
  const config = await getOrCreateRewardConfig();

  const transactions = await db.pointsTransaction.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  // Calculate progress to next tier
  let nextTier: string | null = null;
  let nextThreshold = 0;

  if (balance.tier === "BRONZE") {
    nextTier = "SILVER";
    nextThreshold = config.silverThreshold;
  } else if (balance.tier === "SILVER") {
    nextTier = "GOLD";
    nextThreshold = config.goldThreshold;
  } else if (balance.tier === "GOLD") {
    nextTier = "PLATINUM";
    nextThreshold = config.platinumThreshold;
  }

  const progressPercent = nextThreshold
    ? Math.min(100, Math.floor((balance.totalEarned / nextThreshold) * 100))
    : 100;

  return {
    success: true,
    balance: {
      id: balance.id,
      currentBalance: balance.currentBalance,
      totalEarned: balance.totalEarned,
      totalRedeemed: balance.totalRedeemed,
      tier: balance.tier,
    },
    nextTier,
    nextThreshold,
    progressPercent,
    transactions: transactions.map((t) => ({
      id: t.id,
      type: t.type,
      points: t.points,
      description: t.description,
      createdAt: t.createdAt.toISOString(),
      expiresAt: t.expiresAt?.toISOString() ?? null,
    })),
    config: {
      pointsPerRupee: config.pointsPerRupee,
      minRedeemPoints: config.minRedeemPoints,
      maxRedeemPercent: config.maxRedeemPercent,
      sportsEarnRate: config.sportsEarnRate,
      cafeEarnRate: config.cafeEarnRate,
      silverThreshold: config.silverThreshold,
      goldThreshold: config.goldThreshold,
      platinumThreshold: config.platinumThreshold,
    },
  };
}

/**
 * Get reward config for display in UI (public).
 */
export async function getRewardConfig() {
  const config = await getOrCreateRewardConfig();

  return {
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
