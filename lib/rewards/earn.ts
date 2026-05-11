import { db } from "@/lib/db";
import type { Prisma, RewardTransaction, RewardTxnType } from "@prisma/client";
import { applyBalanceDelta, ensureBalance } from "./balance";
import { getRewardConfig, pointsToPaise } from "./config";

/**
 * Earn-paths. Every entry point is idempotent — the
 * @@unique([type, bookingId]) / @@unique([type, cafeOrderId])
 * indexes catch re-runs (we swallow the constraint error and
 * return { skipped: true }).
 *
 * All paths share the same shape:
 *   1. Load config (cached).
 *   2. If disabled or rate=0, return { skipped: true } early.
 *   3. Open a transaction, upsert balance row, insert ledger row,
 *      apply balance delta. Single-trip atomic.
 */

export interface EarnResult {
  awarded: boolean;
  points?: number;
  txnId?: string;
  reason?: string; // why we skipped (for logs / debug)
}

// ---------- Booking earn ----------

/**
 * Award points for a CONFIRMED booking. Called from
 * confirmCashPayment / confirmUpiPayment / confirmBookingManually.
 *
 * Points are based on the AMOUNT ACTUALLY PAID (not totalAmount,
 * since the customer may have redeemed points to reduce the
 * payable, and we don't earn on the redeemed leg).
 */
export async function awardBookingPoints(
  bookingId: string,
): Promise<EarnResult> {
  const cfg = await getRewardConfig();
  if (!cfg.enabled || cfg.earnRateBookingBps <= 0) {
    return { awarded: false, reason: "disabled or zero rate" };
  }

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: {
      payment: true,
      courtConfig: { select: { sport: true } },
    },
  });
  if (!booking) return { awarded: false, reason: "no booking" };
  if (booking.status !== "CONFIRMED") {
    return { awarded: false, reason: "not confirmed" };
  }
  if (!booking.payment) return { awarded: false, reason: "no payment" };
  // Restrict to enabled sports if the admin set the list.
  if (
    cfg.enabledSports.length > 0 &&
    !cfg.enabledSports.includes(booking.courtConfig.sport)
  ) {
    return { awarded: false, reason: "sport disabled" };
  }

  // Bill base = payment amount in PAISE (Booking.totalAmount is in
  // rupees per existing convention — multiply by 100). Earn on the
  // POST-DISCOUNT, POST-REDEMPTION amount, i.e. money the customer
  // actually paid. That's payment.amount.
  const billPaise = booking.payment.amount * 100;
  const points = computeEarnPoints(billPaise, cfg.earnRateBookingBps);
  if (points <= 0) return { awarded: false, reason: "zero points" };

  return insertEarn({
    userId: booking.userId,
    type: "EARNED_BOOKING",
    points,
    pointsValuePaise: pointsToPaise(points, cfg),
    bookingId,
    cafeOrderId: null,
    expiresAt: monthsFromNow(cfg.pointExpiryMonths),
  });
}

// ---------- Cafe earn ----------

export async function awardCafePoints(
  cafeOrderId: string,
): Promise<EarnResult> {
  const cfg = await getRewardConfig();
  if (!cfg.enabled || !cfg.cafeEarnEnabled || cfg.earnRateCafeBps <= 0) {
    return { awarded: false, reason: "disabled or zero rate" };
  }

  const order = await db.cafeOrder.findUnique({
    where: { id: cafeOrderId },
    include: { payment: true },
  });
  if (!order) return { awarded: false, reason: "no order" };
  if (!order.userId) return { awarded: false, reason: "guest order" };
  if (order.status === "CANCELLED" || order.status === "PENDING") {
    return { awarded: false, reason: "wrong status" };
  }
  if (!order.payment) return { awarded: false, reason: "no payment" };

  const billPaise = order.payment.amount * 100;
  const points = computeEarnPoints(billPaise, cfg.earnRateCafeBps);
  if (points <= 0) return { awarded: false, reason: "zero points" };

  return insertEarn({
    userId: order.userId,
    type: "EARNED_CAFE",
    points,
    pointsValuePaise: pointsToPaise(points, cfg),
    bookingId: null,
    cafeOrderId,
    expiresAt: monthsFromNow(cfg.pointExpiryMonths),
  });
}

// ---------- Signup / Birthday / Referral bonuses ----------

export async function awardSignupBonus(userId: string): Promise<EarnResult> {
  const cfg = await getRewardConfig();
  if (!cfg.enabled || cfg.signupBonusPoints <= 0) {
    return { awarded: false, reason: "disabled or zero" };
  }
  return insertBonusEarn({
    userId,
    type: "EARNED_SIGNUP",
    points: cfg.signupBonusPoints,
    cfg,
    reason: "Signup bonus",
  });
}

export async function awardBirthdayBonus(userId: string): Promise<EarnResult> {
  const cfg = await getRewardConfig();
  if (!cfg.enabled || cfg.birthdayBonusPoints <= 0) {
    return { awarded: false, reason: "disabled or zero" };
  }
  return insertBonusEarn({
    userId,
    type: "EARNED_BIRTHDAY",
    points: cfg.birthdayBonusPoints,
    cfg,
    reason: "Birthday bonus",
  });
}

export async function awardReferralBonus(args: {
  earnerId: string;
  referredId: string;
}): Promise<{ earner: EarnResult; referred: EarnResult }> {
  const cfg = await getRewardConfig();
  const earner = cfg.referralEarnerPoints > 0
    ? await insertBonusEarn({
        userId: args.earnerId,
        type: "EARNED_REFERRAL",
        points: cfg.referralEarnerPoints,
        cfg,
        reason: `Referral bonus (referred user ${args.referredId})`,
      })
    : { awarded: false, reason: "zero" };
  const referred = cfg.referralReferredPoints > 0
    ? await insertBonusEarn({
        userId: args.referredId,
        type: "EARNED_REFERRAL",
        points: cfg.referralReferredPoints,
        cfg,
        reason: `Welcome bonus (referred by ${args.earnerId})`,
      })
    : { awarded: false, reason: "zero" };
  return { earner, referred };
}

// ---------- Admin bulk grant ----------

/**
 * Admin manually grants points (single user OR bulk from
 * /admin/rewards/distribute). Always creates an ADJUSTMENT_AUDIT
 * alert as part of the same transaction so the audit trail
 * surfaces in the alerts dashboard.
 */
export async function adminGrantPoints(args: {
  userId: string;
  points: number; // positive
  actorAdminId: string;
  reason: string;
}): Promise<EarnResult> {
  if (args.points <= 0) {
    return { awarded: false, reason: "points must be positive" };
  }
  const cfg = await getRewardConfig();
  const now = new Date();
  const result = await db.$transaction(async (tx) => {
    await ensureBalance(tx, args.userId);
    const txn = await tx.rewardTransaction.create({
      data: {
        type: "EARNED_ADJUSTMENT",
        points: args.points,
        pointsValuePaise: pointsToPaise(args.points, cfg),
        userId: args.userId,
        actorAdminId: args.actorAdminId,
        reason: args.reason,
        expiresAt: monthsFromNow(cfg.pointExpiryMonths),
      },
    });
    await applyBalanceDelta(tx, {
      userId: args.userId,
      points: args.points,
      type: "EARNED",
      now,
    });
    // Audit alert — always raised for manual adjustments. Closed
    // automatically (status=ACTIONED) since it's not an open
    // incident, just a record.
    await tx.rewardAlert.create({
      data: {
        userId: args.userId,
        kind: "ADJUSTMENT_AUDIT",
        severity: "LOW",
        status: "ACTIONED",
        details: {
          txnId: txn.id,
          points: args.points,
          reason: args.reason,
          actorAdminId: args.actorAdminId,
        },
        resolvedBy: args.actorAdminId,
        resolvedAt: now,
        resolution: "Manual grant — audit only",
      },
    });
    return txn;
  });
  return { awarded: true, points: args.points, txnId: result.id };
}

// ---------- Internals ----------

function computeEarnPoints(billPaise: number, bps: number): number {
  // basis points: 100 bps = 1%. So points = billPaise * bps / 10000,
  // then divided by 100 (paise→rupee) since 1 point = 1 unit of value
  // at the default pointValuePaise=100. Floor to integer.
  // Effectively: points = floor(billRupees * bps / 100).
  const rupees = Math.floor(billPaise / 100);
  return Math.floor((rupees * bps) / 10000);
}

function monthsFromNow(months: number): Date {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

async function insertEarn(args: {
  userId: string;
  type: RewardTxnType;
  points: number;
  pointsValuePaise: number;
  bookingId: string | null;
  cafeOrderId: string | null;
  expiresAt: Date;
}): Promise<EarnResult> {
  const now = new Date();
  try {
    const result = await db.$transaction(async (tx) => {
      await ensureBalance(tx, args.userId);
      const txn = await tx.rewardTransaction.create({
        data: {
          type: args.type,
          points: args.points,
          pointsValuePaise: args.pointsValuePaise,
          userId: args.userId,
          bookingId: args.bookingId,
          cafeOrderId: args.cafeOrderId,
          expiresAt: args.expiresAt,
        },
      });
      await applyBalanceDelta(tx, {
        userId: args.userId,
        points: args.points,
        type: "EARNED",
        now,
      });
      return txn;
    });
    return { awarded: true, points: args.points, txnId: result.id };
  } catch (err) {
    // P2002 = unique violation on the idempotency index. Means
    // we already credited this booking/order — retry-safe no-op.
    if (isUniqueViolation(err)) {
      return { awarded: false, reason: "already credited" };
    }
    throw err;
  }
}

async function insertBonusEarn(args: {
  userId: string;
  type: RewardTxnType;
  points: number;
  cfg: { pointExpiryMonths: number; pointValuePaise: number };
  reason: string;
}): Promise<EarnResult> {
  const now = new Date();
  const result = await db.$transaction(async (tx) => {
    await ensureBalance(tx, args.userId);
    const txn = await tx.rewardTransaction.create({
      data: {
        type: args.type,
        points: args.points,
        pointsValuePaise: args.points * args.cfg.pointValuePaise,
        userId: args.userId,
        reason: args.reason,
        expiresAt: monthsFromNow(args.cfg.pointExpiryMonths),
      },
    });
    await applyBalanceDelta(tx, {
      userId: args.userId,
      points: args.points,
      type: "EARNED",
      now,
    });
    return txn;
  });
  return { awarded: true, points: args.points, txnId: result.id };
}

// Tiny Prisma error type-guard helper. Inline so we don't pull in
// Prisma.PrismaClientKnownRequestError everywhere.
function isUniqueViolation(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}
