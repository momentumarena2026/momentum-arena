import { db } from "@/lib/db";
import type { Prisma, RewardTransaction, RewardTxnType } from "@prisma/client";
import { applyBalanceDelta, applyGuardedDebit, ensureBalance } from "./balance";
import { getRewardConfig, pointsToPaise } from "./config";

/** Credit (EARNED-family) types — the lots a debit can draw from. */
const EARN_TYPES_FIFO: RewardTxnType[] = [
  "EARNED_BOOKING",
  "EARNED_BOOKING_REMAINDER",
  "EARNED_CAFE",
  "EARNED_TOURNAMENT",
  "EARNED_SIGNUP",
  "EARNED_REFERRAL",
  "EARNED_BIRTHDAY",
  "EARNED_ADJUSTMENT",
  "ADJUSTMENT_REFUND",
];

/**
 * Best-effort single-pointer FIFO attribution: the id of the OLDEST
 * earn lot that still has un-consumed points at this instant. Stamped
 * on the REDEEMED row's sourceTxnId purely for the liability report —
 * the expiry sweep does NOT trust this pointer (it reconstructs FIFO
 * over the whole ledger), so a null or approximate value is harmless.
 * Returns null when no live lot can be identified.
 */
async function oldestLiveEarnId(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<string | null> {
  const rows = await tx.rewardTransaction.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, type: true, points: true },
  });
  const earnSet = new Set<RewardTxnType>(EARN_TYPES_FIFO);
  const lots: { id: string; points: number }[] = [];
  let consumed = 0; // running magnitude of every debit already written
  for (const r of rows) {
    if (earnSet.has(r.type)) lots.push({ id: r.id, points: r.points });
    else if (r.points < 0) consumed += -r.points;
  }
  // Drain consumption across lots oldest-first; the first lot with
  // headroom left is the oldest still-live one.
  for (const lot of lots) {
    if (consumed >= lot.points) {
      consumed -= lot.points;
    } else {
      return lot.id;
    }
  }
  return null;
}

/** Marker so we can swallow the Prisma unique-constraint code without
 *  pulling in the full PrismaClientKnownRequestError type everywhere. */
function isUniqueViolation(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}

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
          "EARNED_TOURNAMENT",
          // Partial-pay remainder top-up — same eligibility window
          // as the initial booking earn.
          "EARNED_BOOKING_REMAINDER",
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
 * `sourceTxnId` is set to the oldest still-live earn lot at redemption
 * time (best-effort single-pointer attribution for the liability
 * report). It is NOT a correctness dependency — the redemption is a
 * single row and the expiry sweep reconstructs FIFO from the whole
 * ledger rather than trusting this pointer.
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

/** Redeem points against a tournament entry fee. Same guarded-debit
 *  invariants as bookings; idempotent per team via
 *  @@unique([REDEEMED_TOURNAMENT, tournamentTeamId]). */
export async function redeemForTournament(args: {
  userId: string;
  tournamentTeamId: string;
  points: number;
  billPaise: number;
}): Promise<RedeemResult> {
  return commitRedeem({
    userId: args.userId,
    type: "REDEEMED_TOURNAMENT",
    points: args.points,
    billPaise: args.billPaise,
    bookingId: null,
    cafeOrderId: null,
    tournamentTeamId: args.tournamentTeamId,
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

/**
 * Insert the REDEEMED ledger row + balance delta inside an EXISTING
 * transaction. Used by createBookingFromHold so the booking row and
 * its redemption are atomic (no chance of a paid-but-points-untouched
 * partial-failure).
 *
 * The caller must have already validated the redemption with
 * previewRedemption() at hold-apply time. This helper still
 * defensively re-checks the balance is sufficient — if the user
 * spent points elsewhere between apply-to-hold and pay, we throw
 * so the outer transaction rolls back and the customer sees a
 * "balance changed, please re-confirm" error in the checkout client.
 *
 * Returns enough info for the caller to raise a BULK_REDEMPTION
 * alert OUTSIDE the transaction (kept out of band so a slow alert
 * insert doesn't extend the booking transaction).
 */
export async function commitRedeemInTx(
  tx: Prisma.TransactionClient,
  args: {
    userId: string;
    type: "REDEEMED_BOOKING" | "REDEEMED_CAFE" | "REDEEMED_TOURNAMENT";
    points: number;
    bookingId: string | null;
    cafeOrderId: string | null;
    tournamentTeamId?: string | null;
    /** Cached config — caller looked it up to compute pointsRedeemPaiseSaved
     *  on the hold; re-pass it here so we don't double-fetch inside the txn. */
    cfg: { pointValuePaise: number; bulkRedemptionPaiseThreshold: number };
  },
): Promise<{
  txnId: string;
  discountPaise: number;
  bulkRedemption: boolean;
}> {
  if (args.points <= 0) {
    throw new Error("Cannot commit a non-positive redemption");
  }

  await ensureBalance(tx, args.userId);

  const discountPaise = args.points * args.cfg.pointValuePaise;
  const sourceTxnId = await oldestLiveEarnId(tx, args.userId);
  const row = await tx.rewardTransaction.create({
    data: {
      type: args.type,
      points: -args.points,
      pointsValuePaise: -discountPaise,
      userId: args.userId,
      bookingId: args.bookingId,
      cafeOrderId: args.cafeOrderId,
      sourceTxnId,
    },
  });
  // Atomic conditional debit: the DB re-checks pointsAvailable >= points
  // at write time under a row lock, so two concurrent redemptions cannot
  // both succeed and drive the balance negative. A false return means
  // the points were spent out from under us between preview and now;
  // throw so the outer createBookingFromHold transaction rolls back and
  // the checkout client sees the "balance changed" error. The phrase
  // "Insufficient reward balance" is load-bearing for the orphan-payment
  // handler downstream — keep it.
  const debited = await applyGuardedDebit(tx, {
    userId: args.userId,
    points: args.points,
    now: new Date(),
  });
  if (!debited) {
    throw new Error(
      `Insufficient reward balance: ${args.points} points requested`,
    );
  }

  return {
    txnId: row.id,
    discountPaise,
    bulkRedemption: discountPaise >= args.cfg.bulkRedemptionPaiseThreshold,
  };
}

async function commitRedeem(args: {
  userId: string;
  type: RewardTxnType;
  points: number;
  billPaise: number;
  bookingId: string | null;
  cafeOrderId: string | null;
  tournamentTeamId?: string | null;
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
      const sourceTxnId = await oldestLiveEarnId(tx, args.userId);
      const row = await tx.rewardTransaction.create({
        data: {
          type: args.type,
          points: -args.points, // negative — debit
          pointsValuePaise: -discountPaise,
          userId: args.userId,
          bookingId: args.bookingId,
          cafeOrderId: args.cafeOrderId,
          tournamentTeamId: args.tournamentTeamId ?? null,
          sourceTxnId,
        },
      });
      // Atomic conditional debit — see commitRedeemInTx. Guards against a
      // balance change racing between previewRedemption above and now.
      const debited = await applyGuardedDebit(tx, {
        userId: args.userId,
        points: args.points,
        now,
      });
      if (!debited) {
        throw new Error(
          `Insufficient reward balance: ${args.points} points requested`,
        );
      }
      return row;
    });

    // Anti-abuse: flag bulk-redemption at txn time. Cheap and the
    // alert dashboard wants to see this within seconds, not on the
    // next cron sweep. Awaited (was fire-and-forget): a bare promise in a
    // serverless handler is killed by the freeze, so the flag was being
    // dropped at random. Its failure must not undo the redemption, hence
    // the .catch rather than letting it throw.
    if (discountPaise >= cfg.bulkRedemptionPaiseThreshold) {
      await db.rewardAlert
        .create({
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
        })
        .catch((err) =>
          console.error("[rewards] BULK_REDEMPTION alert failed", err),
        );
    }

    return {
      redeemed: true,
      pointsConsumed: args.points,
      discountPaise,
      txnId: txn.id,
    };
  } catch (err) {
    if (isUniqueViolation(err)) {
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
  tournamentTeamId?: string;
  reason: string;
}): Promise<{ refunded: boolean; txnId?: string }> {
  if (args.points <= 0) return { refunded: false };
  const cfg = await getRewardConfig();
  // Idempotency: one refund per booking / cafe order. A cancel that runs
  // twice, or a webhook + admin action racing, must not re-credit the
  // points. @@unique([ADJUSTMENT_REFUND, bookingId]) would also collide and
  // THROW on the second write, so guard first and return cleanly. (When
  // neither id is set the row is unattributed and this guard is skipped.)
  if (args.bookingId || args.cafeOrderId || args.tournamentTeamId) {
    const existing = await db.rewardTransaction.findFirst({
      where: {
        type: "ADJUSTMENT_REFUND",
        bookingId: args.bookingId ?? undefined,
        cafeOrderId: args.cafeOrderId ?? undefined,
        tournamentTeamId: args.tournamentTeamId ?? undefined,
      },
    });
    if (existing) return { refunded: false, txnId: existing.id };
  }
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
        tournamentTeamId: args.tournamentTeamId ?? null,
        reason: args.reason,
        // Honor the "no expiry" sentinel (pointExpiryMonths=0) by
        // leaving expiresAt null. Earn paths use the
        // expiresAtForMonths helper; the refund branch is the only
        // other writer of EARNED-style rows so it gets the same
        // treatment inline.
        expiresAt:
          cfg.pointExpiryMonths > 0
            ? new Date(
                Date.now() + cfg.pointExpiryMonths * 30 * 24 * 60 * 60 * 1000,
              )
            : null,
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
