import { db } from "@/lib/db";
import { applyBalanceDelta, ensureBalance } from "./balance";
import { getRewardConfig, pointsToPaise } from "./config";

/**
 * Expire-sweep — finds EARNED rows whose expiresAt is in the past
 * AND haven't already been consumed by REDEEMED / EXPIRED /
 * REVOKED rows pointing back at them, and writes one EXPIRED row
 * per expired earn (so the ledger preserves the source).
 *
 * Called daily from /api/cron/rewards-expire.
 *
 * Algorithm:
 *   1. SELECT EARNED rows where expiresAt < now AND not already
 *      fully consumed.
 *   2. For each, the unconsumed remainder = earn.points -
 *      SUM(|points|) of REDEEMED/EXPIRED/REVOKED rows whose
 *      sourceTxnId = earn.id.
 *   3. If remainder > 0, but it's > current pointsAvailable, cap
 *      at available (negative-balance guard).
 *   4. Write EXPIRED row with negative remainder.
 *
 * NOTE: previewRedemption uses an aggregated pool, so FIFO
 * consumption isn't actually wired in v1 redemptions. That means
 * `consumed via sourceTxnId` will always be 0 for non-revoke
 * paths, and the expiry pass essentially treats every EARNED row
 * as a full unconsumed lot at its expiry time, capped by current
 * available balance. This produces correct net balances (because
 * the aggregated pool already accounts for past redemptions);
 * what we lose is per-earn forensic detail. Acceptable for v1.
 */
export async function runExpirySweep(): Promise<{ expired: number; rows: number }> {
  const cfg = await getRewardConfig();
  const now = new Date();
  let totalPoints = 0;
  let rows = 0;

  // Pull expired earns oldest-first, batched.
  const BATCH = 500;
  for (let i = 0; i < 100; i++) {
    const expired = await db.rewardTransaction.findMany({
      where: {
        expiresAt: { lt: now },
        type: {
          in: [
            "EARNED_BOOKING",
            // Partial-pay remainder top-up follows the same
            // expiry rules as the initial booking earn.
            "EARNED_BOOKING_REMAINDER",
            "EARNED_CAFE",
            "EARNED_SIGNUP",
            "EARNED_REFERRAL",
            "EARNED_BIRTHDAY",
            "EARNED_ADJUSTMENT",
            "ADJUSTMENT_REFUND",
          ],
        },
        consumers: {
          // Has no existing EXPIRED consumer.
          none: { type: "EXPIRED" },
        },
      },
      take: BATCH,
      orderBy: { expiresAt: "asc" },
      select: { id: true, userId: true, points: true },
    });
    if (expired.length === 0) break;

    for (const earn of expired) {
      const balance = await db.rewardBalance.findUnique({
        where: { userId: earn.userId },
      });
      const available = balance?.pointsAvailable ?? 0;
      const toExpire = Math.min(earn.points, available);
      if (toExpire <= 0) {
        // Already drained — write a zero-point EXPIRED to mark
        // consumed so we don't re-process this earn forever.
        await db.rewardTransaction.create({
          data: {
            type: "EXPIRED",
            points: 0,
            pointsValuePaise: 0,
            userId: earn.userId,
            sourceTxnId: earn.id,
            reason: "Earn already drained by prior redemptions/revokes",
          },
        });
        continue;
      }
      await db.$transaction(async (tx) => {
        await ensureBalance(tx, earn.userId);
        await tx.rewardTransaction.create({
          data: {
            type: "EXPIRED",
            points: -toExpire,
            pointsValuePaise: -pointsToPaise(toExpire, cfg),
            userId: earn.userId,
            sourceTxnId: earn.id,
            reason: "Points expired (TTL reached)",
          },
        });
        await applyBalanceDelta(tx, {
          userId: earn.userId,
          points: -toExpire,
          type: "EXPIRED",
          now,
        });
      });
      totalPoints += toExpire;
      rows += 1;
    }
    if (expired.length < BATCH) break;
  }
  return { expired: totalPoints, rows };
}
