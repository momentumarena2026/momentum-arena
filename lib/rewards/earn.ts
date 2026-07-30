import { db } from "@/lib/db";
import type {
  Prisma,
  RewardConfig,
  RewardTransaction,
  RewardTxnType,
  Sport,
} from "@prisma/client";
import { applyBalanceDelta, ensureBalance } from "./balance";
import { getRewardConfig, pointsToPaise } from "./config";
import {
  sendTemplatedToUser,
  type PushTemplateKey,
} from "@/lib/push-templates";

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
 * Award points for a CONFIRMED booking. Called from every
 * booking-confirmation surface: confirmCashPayment / confirmUpiPayment /
 * confirmBookingManually (admin actions on customer-started bookings),
 * the Razorpay + PhonePe verify routes, and the static-QR auto-verify
 * webhook.
 *
 * Points are based on the AMOUNT ACTUALLY PAID (not totalAmount,
 * since the customer may have redeemed points to reduce the
 * payable, and we don't earn on the redeemed leg).
 *
 * Bookings that originated on the admin's end (created via
 * adminCreateBooking → Booking.createdByAdminId is non-null) do NOT
 * earn the customer points. That's the product rule: only the
 * customer's own bookings count toward their rewards balance.
 * Gating here (instead of at every caller) is the single source of
 * truth — drop-in safe for the eight + call-sites without having to
 * remember which paths can originate from admin.
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
  // Admin-created bookings don't earn the customer points. The
  // customer didn't make this booking themselves, so they shouldn't
  // accrue rewards for it — admin-only flow (e.g. comp bookings, on-
  // behalf-of bookings, regulars the front desk books in for).
  if (booking.createdByAdminId) {
    return { awarded: false, reason: "admin-created booking" };
  }
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
    expiresAt: expiresAtForMonths(cfg.pointExpiryMonths),
  });
}

/**
 * Award the REMAINDER points for a partial-payment booking. Called
 * from `markRemainderCollected` after the admin records the venue
 * cash collection. The initial EARNED_BOOKING row was awarded on
 * just the advance (Payment.amount at confirm time); this top-up
 * brings the customer's earn up to what the FULL paid amount would
 * have earned — without retroactively re-writing the original row,
 * so the audit log keeps a clean "earned X on advance, then Y on
 * remainder" trail.
 *
 * Idempotent via @@unique([type=EARNED_BOOKING_REMAINDER, bookingId]).
 * Safe to call multiple times — a second `markRemainderCollected`
 * call would short-circuit at the Payment level anyway.
 *
 * Skipped (returns { awarded: false }) when:
 *   - rewards disabled / earn rate zero
 *   - booking not CONFIRMED
 *   - payment isn't COMPLETED yet (no remainder recorded)
 *   - booking was admin-created (same gate as the initial earn)
 *   - sport restricted
 *   - delta vs. the initial earn is <= 0 (e.g. full bill was
 *     covered by the advance, or no points are owed for the
 *     remainder portion after rounding)
 */
export async function awardBookingRemainderPoints(
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
  // The remainder is only "earned" once the venue collection is
  // recorded — Payment.status flips PARTIAL → COMPLETED inside
  // markRemainderCollected, so this gate also stops accidental
  // double-awards if the helper is invoked from any other surface
  // that doesn't carry a fully-paid booking.
  if (booking.payment.status !== "COMPLETED") {
    return { awarded: false, reason: "payment not completed" };
  }
  if (booking.createdByAdminId) {
    return { awarded: false, reason: "admin-created booking" };
  }
  if (
    cfg.enabledSports.length > 0 &&
    !cfg.enabledSports.includes(booking.courtConfig.sport)
  ) {
    return { awarded: false, reason: "sport disabled" };
  }

  // Total points the customer SHOULD have earned for the full bill
  // (Payment.amount now equals advance + venue collection because
  // markRemainderCollected already wrote it). Subtract whatever the
  // initial EARNED_BOOKING row already credited and award the delta.
  // Recomputing via the same formula avoids floor-rounding drift
  // (computeEarnPoints uses Math.floor, so points_on(advance) +
  // points_on(remainder) can be 1 less than points_on(total)).
  const totalBillPaise = booking.payment.amount * 100;
  const expectedTotal = computeEarnPoints(
    totalBillPaise,
    cfg.earnRateBookingBps,
  );
  const initialEarn = await db.rewardTransaction.findFirst({
    where: { bookingId, type: "EARNED_BOOKING" },
    select: { points: true },
  });
  const alreadyAwarded = initialEarn?.points ?? 0;
  const remainderPoints = expectedTotal - alreadyAwarded;
  if (remainderPoints <= 0) {
    return { awarded: false, reason: "no delta to award" };
  }

  return insertEarn({
    userId: booking.userId,
    type: "EARNED_BOOKING_REMAINDER",
    points: remainderPoints,
    pointsValuePaise: pointsToPaise(remainderPoints, cfg),
    bookingId,
    cafeOrderId: null,
    expiresAt: expiresAtForMonths(cfg.pointExpiryMonths),
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
  // PENDING_PAYMENT is the payment-first online state: the order exists but
  // the money has NOT been captured (the CafePayment is still unpaid and the
  // order is invisible to admin tabs). Awarding here credits points for an
  // order nobody has paid for — exclude it alongside CANCELLED/PENDING.
  if (
    order.status === "CANCELLED" ||
    order.status === "PENDING" ||
    order.status === "PENDING_PAYMENT"
  ) {
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
    expiresAt: expiresAtForMonths(cfg.pointExpiryMonths),
  });
}

/**
 * Award points for a CONFIRMED tournament-team registration, on the
 * amount the captain ACTUALLY PAID ONLINE (net of coupon + redeemed
 * points — same product rule as bookings: no earning on the redeemed
 * leg). Uses the booking earn rate; idempotent per team via
 * @@unique([EARNED_TOURNAMENT, tournamentTeamId]).
 */
export async function awardTournamentPoints(
  tournamentTeamId: string,
): Promise<EarnResult> {
  const cfg = await getRewardConfig();
  if (!cfg.enabled || cfg.earnRateBookingBps <= 0) {
    return { awarded: false, reason: "disabled or zero rate" };
  }
  const team = await db.tournamentTeam.findUnique({
    where: { id: tournamentTeamId },
    select: { status: true, captainUserId: true, paidAmount: true },
  });
  if (!team) return { awarded: false, reason: "no team" };
  if (!team.captainUserId) return { awarded: false, reason: "no user" };
  if (team.status !== "CONFIRMED") return { awarded: false, reason: "not confirmed" };
  if (team.paidAmount <= 0) return { awarded: false, reason: "nothing paid" };

  const billPaise = team.paidAmount * 100;
  const points = computeEarnPoints(billPaise, cfg.earnRateBookingBps);
  if (points <= 0) return { awarded: false, reason: "zero points" };

  return insertEarn({
    userId: team.captainUserId,
    type: "EARNED_TOURNAMENT",
    points,
    pointsValuePaise: pointsToPaise(points, cfg),
    bookingId: null,
    cafeOrderId: null,
    tournamentTeamId,
    expiresAt: expiresAtForMonths(cfg.pointExpiryMonths),
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
    // Once per user, ever.
    dedupeWhere: { userId, type: "EARNED_SIGNUP" },
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
    // At most once per birthday window. 200 days comfortably de-dupes a
    // sweep that runs twice (or spans midnight) while still allowing next
    // year's birthday, which is ~365 days out.
    dedupeWhere: {
      userId,
      type: "EARNED_BIRTHDAY",
      createdAt: { gte: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000) },
    },
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
        // Once per (earner, referred friend) pair — the reason string
        // carries the friend id, so a replay for the same friend no-ops
        // while a genuine second referral still credits.
        dedupeWhere: {
          userId: args.earnerId,
          type: "EARNED_REFERRAL",
          reason: `Referral bonus (referred user ${args.referredId})`,
        },
      })
    : { awarded: false, reason: "zero" };
  const referred = cfg.referralReferredPoints > 0
    ? await insertBonusEarn({
        userId: args.referredId,
        type: "EARNED_REFERRAL",
        points: cfg.referralReferredPoints,
        cfg,
        reason: `Welcome bonus (referred by ${args.earnerId})`,
        // A user can only be referred once, ever.
        dedupeWhere: { userId: args.referredId, type: "EARNED_REFERRAL" },
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
        expiresAt: expiresAtForMonths(cfg.pointExpiryMonths),
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
  void sendEarnedPush({
    userId: args.userId,
    points: args.points,
    type: "EARNED_ADJUSTMENT",
  });
  return { awarded: true, points: args.points, txnId: result.id };
}

// ---------- Public previews ----------

/**
 * Mirror of `awardBookingPoints`'s gating logic, minus the DB write.
 * Returns the integer points a customer would earn on a booking of
 * `billPaise` (final payable, post-discount + post-redemption) on the
 * given sport. Returns 0 when the reward engine is off, the rate is
 * zero, the sport is excluded, the booking originated from admin, or
 * the bps math floors out to zero.
 *
 * Used by the checkout pages (web + mobile) to show "earn X points"
 * before the customer commits — reactive to coupon / points / advance
 * changes via the same bill total the gateway initiators use.
 *
 * Stateless + pure given the config: the caller passes the live
 * RewardConfig (so the page can fetch once and recompute on every
 * bill change without round-tripping the DB).
 */
export interface PreviewBookingEarnInput {
  billPaise: number;
  sport: Sport;
  createdByAdmin?: boolean;
  config: Pick<
    RewardConfig,
    "enabled" | "earnRateBookingBps" | "enabledSports"
  >;
}

export function previewBookingEarn(input: PreviewBookingEarnInput): number {
  const { billPaise, sport, createdByAdmin, config } = input;
  if (createdByAdmin) return 0;
  if (!config.enabled || config.earnRateBookingBps <= 0) return 0;
  if (
    config.enabledSports.length > 0 &&
    !(config.enabledSports as Sport[]).includes(sport)
  ) {
    return 0;
  }
  if (!Number.isFinite(billPaise) || billPaise <= 0) return 0;
  return computeEarnPoints(billPaise, config.earnRateBookingBps);
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

// Computes the expiresAt timestamp for newly-earned points.
// `pointExpiryMonths = 0` is the admin's sentinel for "no expiry";
// we collapse that into null so the RewardTransaction.expiresAt
// column (nullable in the schema) reflects "never expires" instead
// of "expires right now".
function expiresAtForMonths(months: number): Date | null {
  if (!Number.isFinite(months) || months <= 0) return null;
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
  tournamentTeamId?: string | null;
  // Nullable so pointExpiryMonths=0 can express "no expiry".
  // expiresAtForMonths(0) returns null. RewardTransaction.expiresAt
  // is `DateTime?` in the schema.
  expiresAt: Date | null;
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
          tournamentTeamId: args.tournamentTeamId ?? null,
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
    // Best-effort push so the user sees their balance bump. Fire-and-
    // forget — push delivery failures shouldn't block the booking flow.
    void sendEarnedPush({
      userId: args.userId,
      points: args.points,
      type: args.type,
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
  // Idempotency predicate. Signup/referral/birthday bonuses carry no
  // bookingId/cafeOrderId, so @@unique([type, bookingId]) can't dedupe them
  // (NULL bookingId is unique-tolerant in Postgres). If a row already
  // matches this predicate the award is a no-op — a retried signup, a
  // replayed referral, or a birthday cron that runs twice cannot
  // double-credit. Checked inside the tx to close the obvious race.
  dedupeWhere?: Prisma.RewardTransactionWhereInput;
}): Promise<EarnResult> {
  const now = new Date();
  const result = await db.$transaction(async (tx) => {
    await ensureBalance(tx, args.userId);
    if (args.dedupeWhere) {
      const existing = await tx.rewardTransaction.findFirst({
        where: args.dedupeWhere,
      });
      if (existing) return null;
    }
    const txn = await tx.rewardTransaction.create({
      data: {
        type: args.type,
        points: args.points,
        pointsValuePaise: args.points * args.cfg.pointValuePaise,
        userId: args.userId,
        reason: args.reason,
        expiresAt: expiresAtForMonths(args.cfg.pointExpiryMonths),
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
  // Deduped — a matching bonus row already existed, so nothing was
  // written and there is nothing to notify about.
  if (!result) return { awarded: false, reason: "already awarded" };
  void sendEarnedPush({
    userId: args.userId,
    points: args.points,
    type: args.type,
  });
  return { awarded: true, points: args.points, txnId: result.id };
}

/**
 * Push notification helper for "you earned N points" events. Maps the
 * specific RewardTxnType to a friendly title so cafe earns / signup
 * bonuses don't all read "Booking reward". Best-effort — wraps in
 * try/catch so a push failure can never break the underlying earn
 * transaction.
 */
async function sendEarnedPush(args: {
  userId: string;
  points: number;
  type: RewardTxnType;
}): Promise<void> {
  // Each earn type is its own admin-editable template (title varies per
  // type; body shared by default). Unknown/legacy types fall back to the
  // manual-adjustment template.
  const templateByType: Partial<Record<RewardTxnType, PushTemplateKey>> = {
    EARNED_BOOKING: "rewards_earned_booking",
    EARNED_BOOKING_REMAINDER: "rewards_earned_booking_remainder",
    EARNED_CAFE: "rewards_earned_cafe",
    EARNED_SIGNUP: "rewards_earned_signup",
    EARNED_REFERRAL: "rewards_earned_referral",
    EARNED_BIRTHDAY: "rewards_earned_birthday",
    EARNED_ADJUSTMENT: "rewards_earned_adjustment",
  };
  const key = templateByType[args.type] ?? "rewards_earned_adjustment";
  try {
    await sendTemplatedToUser(
      args.userId,
      key,
      { points: args.points.toLocaleString("en-IN") },
      {
        kind: "rewards_earned",
        points: String(args.points),
        txnType: args.type,
      },
    );
  } catch (err) {
    console.warn(
      "[rewards] earn push failed:",
      err instanceof Error ? err.message : err,
    );
  }
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
