import { db } from "@/lib/db";
import { RewardTier, type RewardConfig } from "@prisma/client";

const DEFAULT_CONFIG = {
  sportsEarnRate: 1,
  cafeEarnRate: 2,
  referralBonus: 100,
  pointsPerRupee: 10,
  minRedeemPoints: 100,
  maxRedeemPercent: 5000, // basis points: 5000 = 50%
  silverThreshold: 500,
  goldThreshold: 2000,
  platinumThreshold: 5000,
  bronzeMultiplier: 10000, // 1x
  silverMultiplier: 12500, // 1.25x
  goldMultiplier: 15000, // 1.5x
  platinumMultiplier: 20000, // 2x
  pointsExpiryDays: 365,
};

/**
 * Get the singleton RewardConfig, creating with defaults if it doesn't exist.
 */
export async function getOrCreateRewardConfig(): Promise<RewardConfig> {
  const existing = await db.rewardConfig.findFirst();
  if (existing) return existing;

  return db.rewardConfig.create({ data: DEFAULT_CONFIG });
}

/**
 * Get or create a RewardPointsBalance for a user.
 */
export async function getOrCreateBalance(userId: string) {
  const existing = await db.rewardPointsBalance.findUnique({
    where: { userId },
  });
  if (existing) return existing;

  return db.rewardPointsBalance.create({
    data: { userId },
  });
}

/**
 * Calculate how many points to earn for a given spend.
 * Formula: floor(amountPaise / 100 * earnRate * tierMultiplier / 10000)
 * earnRate = points per ₹1 spent
 * tierMultiplier = basis points (10000 = 1x)
 */
export function calculateEarnPoints(
  amountPaise: number,
  earnRate: number,
  tierMultiplier: number
): number {
  return Math.floor((amountPaise / 100) * earnRate * (tierMultiplier / 10000));
}

/**
 * Get the tier multiplier (in basis points) for a given tier.
 */
export function getTierMultiplier(
  tier: RewardTier,
  config: RewardConfig
): number {
  switch (tier) {
    case "BRONZE":
      return config.bronzeMultiplier;
    case "SILVER":
      return config.silverMultiplier;
    case "GOLD":
      return config.goldMultiplier;
    case "PLATINUM":
      return config.platinumMultiplier;
    default:
      return config.bronzeMultiplier;
  }
}

/**
 * Determine the appropriate tier based on total lifetime earned points.
 */
export function recalculateTier(
  totalEarned: number,
  config: RewardConfig
): RewardTier {
  if (totalEarned >= config.platinumThreshold) return "PLATINUM";
  if (totalEarned >= config.goldThreshold) return "GOLD";
  if (totalEarned >= config.silverThreshold) return "SILVER";
  return "BRONZE";
}

/**
 * Convert points to paise value for redemption.
 * Formula: floor(points / pointsPerRupee) * 100
 */
export function calculateRedeemValue(
  points: number,
  config: RewardConfig
): number {
  return Math.floor(points / config.pointsPerRupee) * 100;
}

/**
 * Calculate max redeemable points given order amount, balance, and config.
 * Caps by maxRedeemPercent (basis points) and current balance.
 */
export function calculateMaxRedeemPoints(
  orderAmountPaise: number,
  currentBalance: number,
  config: RewardConfig
): number {
  // Max paise that can be discounted = orderAmountPaise * maxRedeemPercent / 10000
  const maxDiscountPaise = Math.floor(
    (orderAmountPaise * config.maxRedeemPercent) / 10000
  );

  // Convert max discount paise to points: maxDiscountPaise / 100 * pointsPerRupee
  const maxPointsByOrder = Math.floor(
    (maxDiscountPaise / 100) * config.pointsPerRupee
  );

  // Cap by balance and ensure minimum
  const maxPoints = Math.min(maxPointsByOrder, currentBalance);

  if (maxPoints < config.minRedeemPoints) return 0;

  return maxPoints;
}
