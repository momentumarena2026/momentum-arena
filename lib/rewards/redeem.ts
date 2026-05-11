import { db } from "@/lib/db";
import type { Prisma, RewardTransaction, RewardTxnType } from "@prisma/client";
import { applyBalanceDelta, ensureBalance } from "./balance";
import { getRewardConfig, pointsToPaise } from "./config";

/**
 * Redeem-paths. Validates against the four guards in RewardConfig
 * (minPointsToRedeem, maxRedemptionPctOfBill, maxRedemptionPaise,
 * earnToRedeemMinHours), then consumes points FIFO from EARNED
 * transactions (oldest expiry first).
 *
 * Returns the ₹-paise discount the caller should apply to the
 * bill (Booking.discountAmount or CafeOrder.discountAmount), AND
 * the actual points consumed (which may be fewer than requested
 * if the user's available pool is below the request).
 */

export interface RedemptionPreview {
  /** Max points the user is allowed to redeem against this bill */
  maxPoints: number;
  /** Equivalent ₹ paise discount at maxPoints */
  maxPaise: number;
  /** Reason if maxPoints=0 (e.g. "below min threshold", "hold active") */
  blockedReason?: string;
}

/**
 * Pure calculation — what's the largest valid redemption for this
 * user on a bill of `billPaise`? Doesn't write anything.
 */
export async function previewRedemption(args: {
  userId: string;
  billPaise: number;
}): Promise<RedemptionPreview> {
  const cfg = await getRewardConfig();
  if (!cfg.enabled) {
    return { maxPoints: 0, maxPaise: 0, blockedReason: "disabled" };
  }

  const balance = await db.rewardBalance.findUnique({
    where: { userId: args.userId },
  });
  const available = balance?.pointsAvailable ?? 0;
  if (available < cfg.minPointsToRedeem) {
    return {
      maxPoints: 0,
      maxPaise: 0,
      blockedReason: `Need at least ${cfg.minPointsToRedeem} points`,
    };
  }

  // Compute redeemable pool — exclude EARNED rows still inside the
  // earn-to-redeem hold window.
  const holdCutoff = new Date(
    Date.now() - cfg.earnToRedeemMinHours * 60 * 60 * 1000,
  );
  const eligibleAgg = await db.rewardTransaction.aggregate({
    where: {
      userId: args.userId,
      type: {
        in: [
          "EARNED_BOOKING",
          "EARNED_CAFE",
          "EARNED_SIGNUP",
          "EARNED_REFERRAL",
          "EARNED_BIRTHDAY",
          "EARNED_ADJUSTMENT",
          "ADJUSTMENT_REFUND",
        ],
      },
      createdAt: { lte: holdCutoff },
      // We don't filter by !expired here — the expiry cron writes
      // EXPIRED rows that subtract from balance directly, so the
      // available pool is already net.
    },
    _sum: { points: true },
  });
  // Pool of "eligible-by-age" earns. Subtract everything already
  // consumed (redemptions, expirations, revocations) from this.
  const consumedAgg = await db.rewardTransaction.aggregate({
    where: {
      userId: args.userId,
      type: {
        in: ["REDEEMED_BOOKING", "REDEEMED_CAFE", "EXPIRED", "REVOKED", "ADJUSTMENT_DEBIT"],
      },
    },
    _sum: { points: true },
  });
  const eligibleEarned = eligibleAgg._sum.points ?? 0;
  const consumed = consumedAgg._sum.points ?? 0; // negative
  // eligibleAvailable = eligible-earned + consumed-(negative)
  const eligibleAvailable = Math.max(0, eligibleEarned + consumed);
  if (eligibleAvailable < cfg.minPointsToRedeem) {
    return {
      maxPoints: 0,
      maxPaise: 0,
      blockedReason: `Recently-earned points are still in their ${cfg.earnToRedeemMinHours}h hold`,
    };
  }

  // Cap by max % of bill and absolute paise cap.
  const billCapPaise = Math.floor(
    (args.billPaise * cfg.maxRedemptionPctOfBill) / 100,
  );
  const capPaise = Math.min(billCapPaise, cfg.maxRedemptionPaisePerTxn);
  const maxByCapPoints = Math.floor(capPaise / cfg.pointValuePaise);
  const maxPoints = Math.min(eligibleAvailable, maxByCapPoints);
  const maxPaise = pointsToPaise(maxPoints, cfg);
  return { maxPoints, maxPaise };
}

export interface RedeemResult {
  redeemed: boolean;
  pointsConsumed?: number;
  discountPaise?: number;
  txnId?: string;
  error?: string;
}

/**
 * Commit a redemption. Inserts a single REDEEMED_* ledger row and
 * decrements the balance. Always called inside an outer transaction
 * by the caller (e.g. the booking lock-to-checkout flow).
 *
 * `sourceTxnId` is left null on the REDEEMED row itself — FIFO
 * tracking against specific EARNED rows isn't needed for v1
 * (we'd consume from earliest-expiring earns, but the simpler
 * "subtract from pool" model is what the guard rails enforce
 * anyway).
 */
export async function redeemForBooking(args: {
  userId: string;
  bookingId: string;
  points: number;
  billPaise: number;
}): Promise<RedeemResult> {
  return commitRedeem({
    userId: args.userId,
    type: "REDEEMED_BOOKING",
    points: args.points,
    billPaise: args.billPaise,
    bookingId: args.bookingId,
    cafeOrderId: null,
  });
}

export async function redeemForCafeOrder(args: {
  userId: string;
  cafeOrderId: string;
  points: number;
  billPaise: number;
}): Promise<RedeemResult> {
  return commitRedeem({
    userId: args.userId,
    type: "REDEEMED_CAFE",
    points: args.points,
    billPaise: args.billPaise,
    bookingId: null,
    cafeOrderId: args.cafeOrderId,
  });
}

async function commitRedeem(args: {
  userId: string;
  type: RewardTxnType;
  points: number;
  billPaise: number;
  bookingId: string | null;
  cafeOrderId: string | null;
}): Promise<RedeemResult> {
  if (args.points <= 0) return { redeemed: false, error: "no points" };

  const cfg = await getRewardConfig();
  const preview = await previewRedemption({
    userId: args.userId,
    billPaise: args.billPaise,
  });
  if (preview.blockedReason) {
    return { redeemed: false, error: preview.blockedReason };
  }
  if (args.points > preview.maxPoints) {
    return {
      redeemed: false,
      error: `Max ${preview.maxPoints} points allowed`,
    };
  }
  if (args.points < cfg.minPointsToRedeem) {
    return {
      redeemed: false,
      error: `Min ${cfg.minPointsToRedeem} points`,
    };
  }

  const discountPaise = pointsToPaise(args.points, cfg);
  const now = new Date();

  try {
    const txn = await db.$transaction(async (tx) => {
      await ensureBalance(tx, args.userId);
      const row = await tx.rewardTransaction.create({
        data: {
          type: args.type,
          points: -args.points, // negative — debit
          pointsValuePaise: -discountPaise,
          userId: args.userId,
          bookingId: args.bookingId,
          cafeOrderId: args.cafeOrderId,
        },
      });
      await applyBalanceDelta(tx, {
        userId: args.userId,
        points: -args.points,
        type: "REDEEMED",
        now,
      });
      return row;
    });

    // Anti-abuse: flag bulk-redemption at txn time. Cheap and the
    // alert dashboard wants to see this within seconds, not on the
    // next cron sweep.
    if (discountPaise >= cfg.bulkRedemptionPaiseThreshold) {
      void db.rewardAlert.create({
        data: {
          userId: args.userId,
          kind: "BULK_REDEMPTION",
          severity: "MEDIUM",
          status: "OPEN",
          details: {
            txnId: txn.id,
            points: args.points,
            paise: discountPaise,
            threshold: cfg.bulkRedemptionPaiseThreshold,
            bookingId: args.bookingId,
            cafeOrderId: args.cafeOrderId,
          },
        },
      });
    }

    return {
      redeemed: true,
      pointsConsumed: args.points,
      discountPaise,
      txnId: txn.id,
    };
  } catch (err) {
    if (
      err !== null &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return { redeemed: false, error: "already redeemed" };
    }
    throw err;
  }
}

/**
 * Re-credit a previously-redeemed amount, e.g. when the booking
 * the points were spent on got cancelled. Creates an
 * ADJUSTMENT_REFUND row.
 */
export async function refundRedemption(args: {
  userId: string;
  points: number;
  bookingId?: string;
  cafeOrderId?: string;
  reason: string;
}): Promise<{ refunded: boolean; txnId?: string }> {
  if (args.points <= 0) return { refunded: false };
  const cfg = await getRewardConfig();
  const now = new Date();
  const row = await db.$transaction(async (tx) => {
    await ensureBalance(tx, args.userId);
    const t = await tx.rewardTransaction.create({
      data: {
        type: "ADJUSTMENT_REFUND",
        points: args.points,
        pointsValuePaise: pointsToPaise(args.points, cfg),
        userId: args.userId,
        bookingId: args.bookingId ?? null,
        cafeOrderId: args.cafeOrderId ?? null,
        reason: args.reason,
        expiresAt: new Date(
          Date.now() + cfg.pointExpiryMonths * 30 * 24 * 60 * 60 * 1000,
        ),
      },
    });
    await applyBalanceDelta(tx, {
      userId: args.userId,
      points: args.points,
      type: "ADJUSTMENT_REFUND",
      now,
    });
    return t;
  });
  return { refunded: true, txnId: row.id };
}
