import { db } from "@/lib/db";
import type { RewardConfig } from "@prisma/client";

/**
 * Singleton RewardConfig accessor. Hot-cached in memory for the
 * lifetime of the serverless invocation — the config row is read
 * on every earn/redeem/dashboard render and changes only when an
 * admin saves a new config, so a cache TTL on the order of the
 * invocation lifetime is plenty.
 *
 * Bust via `invalidateRewardConfigCache()` after a config save.
 */
let cached: RewardConfig | null = null;
let cachedAtMs = 0;
const CACHE_TTL_MS = 60_000; // 1 min — safe against multi-server staleness

export async function getRewardConfig(): Promise<RewardConfig> {
  const now = Date.now();
  if (cached && now - cachedAtMs < CACHE_TTL_MS) return cached;

  // Use upsert so a brand-new DB without the seed row still works.
  const cfg = await db.rewardConfig.upsert({
    where: { id: "singleton" },
    create: { id: "singleton" },
    update: {},
  });
  cached = cfg;
  cachedAtMs = now;
  return cfg;
}

export function invalidateRewardConfigCache(): void {
  cached = null;
  cachedAtMs = 0;
}

/** Convert a points count to its ₹-equivalent in paise. */
export function pointsToPaise(points: number, cfg: RewardConfig): number {
  return points * cfg.pointValuePaise;
}

/** Convert a ₹ amount (in paise) to points, floored. */
export function paiseToPoints(paise: number, cfg: RewardConfig): number {
  if (cfg.pointValuePaise <= 0) return 0;
  return Math.floor(paise / cfg.pointValuePaise);
}
