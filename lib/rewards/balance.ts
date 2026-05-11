import { db } from "@/lib/db";
import type { Prisma, RewardBalance } from "@prisma/client";

/**
 * Ensure a RewardBalance row exists for the user. Idempotent
 * upsert — safe to call from any earn/redeem path.
 */
export async function ensureBalance(
  tx: Prisma.TransactionClient | typeof db,
  userId: string,
): Promise<RewardBalance> {
  return tx.rewardBalance.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

/**
 * Apply a balance delta in lockstep with a ledger insert. Caller
 * passes the txn type so we update the right lifetime accumulator.
 *
 * MUST be called inside a Prisma transaction (the same one that
 * inserts the RewardTransaction row) so balance and ledger never
 * diverge.
 */
export async function applyBalanceDelta(
  tx: Prisma.TransactionClient,
  args: {
    userId: string;
    points: number; // signed
    type:
      | "EARNED"
      | "REDEEMED"
      | "EXPIRED"
      | "REVOKED"
      | "ADJUSTMENT_REFUND"
      | "ADJUSTMENT_DEBIT";
    now: Date;
  },
): Promise<void> {
  const { userId, points, type, now } = args;

  // Build the field updates based on txn kind. pointsAvailable
  // always shifts by `points` (signed). Lifetime accumulators are
  // always non-negative (we add Math.abs).
  const data: Prisma.RewardBalanceUpdateInput = {
    pointsAvailable: { increment: points },
    lastTransactionAt: now,
  };
  const abs = Math.abs(points);
  switch (type) {
    case "EARNED":
    case "ADJUSTMENT_REFUND":
      data.pointsLifetimeEarned = { increment: abs };
      break;
    case "REDEEMED":
      data.pointsLifetimeRedeemed = { increment: abs };
      break;
    case "EXPIRED":
      data.pointsLifetimeExpired = { increment: abs };
      break;
    case "REVOKED":
    case "ADJUSTMENT_DEBIT":
      data.pointsLifetimeRevoked = { increment: abs };
      break;
  }

  await tx.rewardBalance.update({ where: { userId }, data });
}

/**
 * Read-only balance for a single user. Returns a zeroed-out row
 * if the user has never had a points transaction.
 */
export async function readBalance(userId: string): Promise<RewardBalance> {
  const existing = await db.rewardBalance.findUnique({ where: { userId } });
  if (existing) return existing;
  return {
    userId,
    pointsAvailable: 0,
    pointsLifetimeEarned: 0,
    pointsLifetimeRedeemed: 0,
    pointsLifetimeExpired: 0,
    pointsLifetimeRevoked: 0,
    lastTransactionAt: null,
  };
}
