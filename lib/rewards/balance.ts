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
 * Atomic guarded DEBIT for the redemption path.
 *
 * applyBalanceDelta's read-then-write is unsafe for debits: two
 * concurrent redemptions can both read the same pointsAvailable and
 * both pass an application-level "available >= points" check before
 * either writes, double-spending into a NEGATIVE balance. This issues
 * a SINGLE conditional decrement the database evaluates under a row
 * lock — the WHERE re-checks `pointsAvailable >= points` at write time,
 * so of two racing debits at most one can match.
 *
 * Returns true when the debit was applied, false when the balance was
 * insufficient at write time (the caller must roll its transaction
 * back). REDEEMED-only: it bumps pointsLifetimeRedeemed, mirroring the
 * "REDEEMED" branch of applyBalanceDelta; other debit kinds keep using
 * applyBalanceDelta.
 */
export async function applyGuardedDebit(
  tx: Prisma.TransactionClient,
  args: {
    userId: string;
    points: number; // POSITIVE magnitude to debit
    now: Date;
  },
): Promise<boolean> {
  const { userId, points, now } = args;
  const res = await tx.rewardBalance.updateMany({
    where: { userId, pointsAvailable: { gte: points } },
    data: {
      pointsAvailable: { decrement: points },
      pointsLifetimeRedeemed: { increment: points },
      lastTransactionAt: now,
    },
  });
  return res.count > 0;
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
