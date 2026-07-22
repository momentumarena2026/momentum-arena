import { db } from "@/lib/db";
import type { RewardConfig, RewardTxnType } from "@prisma/client";
import { applyBalanceDelta, ensureBalance } from "./balance";
import { getRewardConfig, pointsToPaise } from "./config";

/** Credit (EARNED-family) types — every kind of lot that holds points. */
const EARN_TYPES: RewardTxnType[] = [
  "EARNED_BOOKING",
  // Partial-pay remainder top-up follows the same expiry rules as the
  // initial booking earn.
  "EARNED_BOOKING_REMAINDER",
  "EARNED_CAFE",
  "EARNED_SIGNUP",
  "EARNED_REFERRAL",
  "EARNED_BIRTHDAY",
  "EARNED_ADJUSTMENT",
  "ADJUSTMENT_REFUND",
];

/** Debit types — everything that consumes a lot's points. */
const DEBIT_TYPES: RewardTxnType[] = [
  "REDEEMED_BOOKING",
  "REDEEMED_CAFE",
  "EXPIRED",
  "REVOKED",
  "ADJUSTMENT_DEBIT",
];

/**
 * Expire-sweep — writes one EXPIRED row per expired earn lot for the
 * lot's TRUE unconsumed remainder, so a lot that was already spent
 * (REDEEMED), clawed back (REVOKED) or previously expired is never
 * expired again out of newer, still-live points.
 *
 * Called daily from /api/cron/rewards-expire.
 *
 * Why FIFO reconstruction instead of the sourceTxnId pointer: redeem
 * historically wrote REDEEMED rows with sourceTxnId=null, so
 * consumption is invisible to a pointer-based filter and the legacy
 * null rows are still in the database. Instead, per user, we sum ALL
 * debits and drain that consumption across the lots oldest-first — this
 * yields each lot's live remainder regardless of how (or whether) any
 * individual debit was attributed. Because past EXPIRED rows count as
 * consumption, an already-expired lot reconstructs to 0 remaining and
 * is never re-expired; a per-lot EXPIRED tombstone (which may carry 0
 * points) additionally stops the WHERE from re-selecting it next night.
 */
export async function runExpirySweep(): Promise<{ expired: number; rows: number }> {
  const cfg = await getRewardConfig();
  const now = new Date();
  let totalPoints = 0;
  let rows = 0;

  // Walk the whole table, batched. We process each user completely the
  // first time they appear (expireUser sweeps ALL of that user's expired
  // lots, not just the ones in this batch slice), then remember them so
  // a later batch can't redo the work.
  const BATCH = 500;
  const processed = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const expired = await db.rewardTransaction.findMany({
      where: {
        expiresAt: { lt: now },
        type: { in: EARN_TYPES },
        consumers: {
          // Has no existing EXPIRED consumer (tombstone or real debit).
          none: { type: "EXPIRED" },
        },
      },
      take: BATCH,
      orderBy: { expiresAt: "asc" },
      select: { userId: true },
    });
    if (expired.length === 0) break;

    const users = [...new Set(expired.map((e) => e.userId))].filter(
      (u) => !processed.has(u),
    );
    // Nothing new — every row in this batch belongs to a user we already
    // swept. Stop rather than spin (also guards against a stuck loop).
    if (users.length === 0) break;

    for (const userId of users) {
      const res = await expireUser(userId, now, cfg);
      totalPoints += res.points;
      rows += res.rows;
      processed.add(userId);
    }
    if (expired.length < BATCH) break;
  }
  return { expired: totalPoints, rows };
}

/**
 * Expire every past-due, not-yet-tombstoned lot for ONE user. Loads the
 * user's whole ledger once, reconstructs each lot's live remainder via
 * FIFO, then writes the EXPIRED rows.
 */
async function expireUser(
  userId: string,
  now: Date,
  cfg: RewardConfig,
): Promise<{ points: number; rows: number }> {
  const earnSet = new Set<RewardTxnType>(EARN_TYPES);
  const debitSet = new Set<RewardTxnType>(DEBIT_TYPES);

  const all = await db.rewardTransaction.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, type: true, points: true, expiresAt: true, sourceTxnId: true },
  });

  // Lots (credits) oldest-first, total consumption, and the set of lots
  // that already carry an EXPIRED consumer (so we never write twice).
  const lots: { id: string; points: number; expiresAt: Date | null }[] = [];
  let consumed = 0;
  const alreadyExpired = new Set<string>();
  for (const r of all) {
    if (earnSet.has(r.type)) {
      lots.push({ id: r.id, points: r.points, expiresAt: r.expiresAt });
    } else if (debitSet.has(r.type)) {
      consumed += Math.abs(r.points);
      if (r.type === "EXPIRED" && r.sourceTxnId) alreadyExpired.add(r.sourceTxnId);
    }
  }

  // FIFO: drain total consumption across the lots oldest-first. What is
  // left on each lot is its true live remainder. Past EXPIRED debits are
  // part of `consumed`, so lots expired on earlier nights absorb their
  // own prior expiry here and reconstruct to 0.
  const liveRemaining = new Map<string, number>();
  let remainingConsumption = consumed;
  for (const lot of lots) {
    const absorb = Math.min(lot.points, remainingConsumption);
    liveRemaining.set(lot.id, lot.points - absorb);
    remainingConsumption -= absorb;
  }

  // Expire the past-due, not-yet-tombstoned lots oldest-first. Each lot's
  // remainder is already its own non-overlapping FIFO share, so writing
  // one EXPIRED row per lot can never drive pointsAvailable below the sum
  // of the user's still-live (not-yet-expiring) lots.
  let points = 0;
  let rows = 0;
  for (const lot of lots) {
    if (!lot.expiresAt || lot.expiresAt >= now) continue;
    if (alreadyExpired.has(lot.id)) continue;
    const remaining = liveRemaining.get(lot.id) ?? 0;
    if (remaining <= 0) {
      // Fully drained before expiry — write a zero-point tombstone so
      // the nightly WHERE stops re-selecting this lot forever.
      await db.rewardTransaction.create({
        data: {
          type: "EXPIRED",
          points: 0,
          pointsValuePaise: 0,
          userId,
          sourceTxnId: lot.id,
          reason: "Earn already drained by prior redemptions/revokes",
        },
      });
      continue;
    }
    await db.$transaction(async (tx) => {
      await ensureBalance(tx, userId);
      await tx.rewardTransaction.create({
        data: {
          type: "EXPIRED",
          points: -remaining,
          pointsValuePaise: -pointsToPaise(remaining, cfg),
          userId,
          sourceTxnId: lot.id,
          reason: "Points expired (TTL reached)",
        },
      });
      await applyBalanceDelta(tx, {
        userId,
        points: -remaining,
        type: "EXPIRED",
        now,
      });
    });
    points += remaining;
    rows += 1;
  }
  return { points, rows };
}
