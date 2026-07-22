import { db } from "@/lib/db";
import { applyBalanceDelta, ensureBalance } from "./balance";
import { getRewardConfig, pointsToPaise } from "./config";
import { refundRedemption } from "./redeem";

/**
 * Booking-cancel reward unwind.
 *
 * Per the user's spec: "in case where booking is cancelled there
 * are points attached to that booking should be reverted back".
 * That covers BOTH directions:
 *
 *   1. EARNED on this booking → revoke (clawback). New REVOKED txn
 *      with negative points. If the user has already spent some of
 *      these points, we revoke up to current pointsAvailable; the
 *      shortfall raises a PARTIAL_REVOKE_SHORTFALL alert so an
 *      admin can decide whether to chase or write off (we never
 *      let balance go negative).
 *
 *   2. REDEEMED on this booking → re-credit via
 *      ADJUSTMENT_REFUND. The user gets their redeemed points back
 *      since the slot didn't actually happen.
 *
 * Idempotent — safe to call from both cancelBooking + refundBooking
 * (the @@unique([type, bookingId]) constraint prevents double-revoke).
 */
export async function revokeBookingRewards(
  bookingId: string,
): Promise<{ revokedPoints: number; refundedPoints: number }> {
  const cfg = await getRewardConfig();

  // Look up every earn row for this booking. Partial-pay bookings
  // can carry BOTH an EARNED_BOOKING (credited at advance time) AND
  // an EARNED_BOOKING_REMAINDER (credited when admin marks the
  // remainder collected) — the clawback needs to sum both so we
  // don't leave half the credit floating after a cancel.
  const earns = await db.rewardTransaction.findMany({
    where: {
      bookingId,
      type: { in: ["EARNED_BOOKING", "EARNED_BOOKING_REMAINDER"] },
    },
  });
  const existingRevoke = await db.rewardTransaction.findFirst({
    where: { bookingId, type: "REVOKED" },
  });
  const redemption = await db.rewardTransaction.findFirst({
    where: { bookingId, type: "REDEEMED_BOOKING" },
  });

  let revokedPoints = 0;
  let refundedPoints = 0;

  // 1. Refund the redemption FIRST if there was one. abs() because the
  //    stored points on a REDEEMED row is negative. Ordering is
  //    load-bearing: the earn clawback below caps itself at the CURRENT
  //    balance, so the redemption re-credit has to land first — else a
  //    clawback that is actually collectible once the redeemed points
  //    are handed back gets mis-read as a shortfall.
  if (redemption) {
    const existingRefund = await db.rewardTransaction.findFirst({
      where: { bookingId, type: "ADJUSTMENT_REFUND" },
    });
    if (!existingRefund) {
      const points = Math.abs(redemption.points);
      const result = await refundRedemption({
        userId: redemption.userId,
        points,
        bookingId,
        reason: "Booking cancelled — redemption returned",
      });
      if (result.refunded) refundedPoints = points;
    }
  }

  // 2. Clawback the earn (only once). Single REVOKED row per
  //    booking covers the sum of both earn rows — the
  //    @@unique([type=REVOKED, bookingId]) constraint allows only
  //    one entry. sourceTxnId points to the initial earn row so the
  //    audit trail still has a useful anchor; the breakdown lives
  //    in the `reason` text and the existing earn rows are
  //    discoverable via the bookingId.
  //
  //    `available` is read AFTER the redemption refund above, so the
  //    shortfall is judged against the post-refund balance: a genuine
  //    shortfall (earned points truly spent elsewhere) still caps the
  //    clawback and still alerts, but a refund that covers the earn no
  //    longer trips a false PARTIAL_REVOKE_SHORTFALL.
  if (earns.length > 0 && !existingRevoke) {
    const userId = earns[0].userId;
    const totalEarned = earns.reduce((sum, e) => sum + e.points, 0);
    const balance = await db.rewardBalance.findUnique({
      where: { userId },
    });
    const available = balance?.pointsAvailable ?? 0;
    const wantedClawback = totalEarned;
    const actualClawback = Math.min(available, wantedClawback);
    const shortfall = wantedClawback - actualClawback;
    // Prefer the initial EARNED_BOOKING row as sourceTxnId so the
    // legacy audit relationships still line up; fall back to the
    // remainder row when the booking somehow has only the top-up
    // (shouldn't happen but defensive).
    const sourceTxn =
      earns.find((e) => e.type === "EARNED_BOOKING") ?? earns[0];
    const hasRemainder = earns.some(
      (e) => e.type === "EARNED_BOOKING_REMAINDER",
    );

    if (actualClawback > 0) {
      const now = new Date();
      try {
        await db.$transaction(async (tx) => {
          await ensureBalance(tx, userId);
          await tx.rewardTransaction.create({
            data: {
              type: "REVOKED",
              points: -actualClawback,
              pointsValuePaise: -pointsToPaise(actualClawback, cfg),
              userId,
              bookingId,
              sourceTxnId: sourceTxn.id,
              reason:
                shortfall > 0
                  ? `Booking cancelled — partial clawback (${actualClawback} of ${wantedClawback} points${hasRemainder ? ", incl. remainder" : ""})`
                  : `Booking cancelled — earn revoked${hasRemainder ? " (advance + remainder)" : ""}`,
            },
          });
          await applyBalanceDelta(tx, {
            userId,
            points: -actualClawback,
            type: "REVOKED",
            now,
          });
        });
        revokedPoints = actualClawback;
      } catch (err) {
        // Idempotency violation = already revoked, treat as success.
        if (!isUniqueViolation(err)) throw err;
      }
    }

    // Flag partial clawbacks so an admin can decide policy — but only
    // ONCE per booking. When actualClawback is 0 (earn fully spent) no
    // REVOKED row is written, so the `!existingRevoke` guard above never
    // trips on a re-run; without this dedupe a repeated cancel would
    // re-raise the same shortfall alert every time.
    if (shortfall > 0) {
      const openAlerts = await db.rewardAlert.findMany({
        where: { userId, kind: "PARTIAL_REVOKE_SHORTFALL", status: "OPEN" },
        select: { details: true },
      });
      const alreadyFlagged = openAlerts.some(
        (a) =>
          a.details !== null &&
          typeof a.details === "object" &&
          !Array.isArray(a.details) &&
          (a.details as Record<string, unknown>).bookingId === bookingId,
      );
      if (!alreadyFlagged) {
        await db.rewardAlert.create({
          data: {
            userId,
            kind: "PARTIAL_REVOKE_SHORTFALL",
            severity: "MEDIUM",
            status: "OPEN",
            details: {
              bookingId,
              wantedClawback,
              actualClawback,
              shortfall,
              earnTxnId: sourceTxn.id,
              includesRemainder: hasRemainder,
            },
          },
        });
      }
    }
  }

  return { revokedPoints, refundedPoints };
}

/**
 * Cafe-refund reward unwind — the cafe analogue of
 * revokeBookingRewards, keyed on cafeOrderId and clawing back
 * EARNED_CAFE instead of the booking earn types.
 *
 * When an admin refunds a completed cafe order (updateCafePayment →
 * status REFUNDED) the customer gets their money back, so the
 * EARNED_CAFE points that completion credited must be clawed back too —
 * otherwise they keep redeemable credit on money that was returned.
 * cancelCafeOrder refuses COMPLETED orders, so the REFUNDED payment
 * branch is the only refund route for exactly the orders that earned.
 * A REDEEMED_CAFE spend on the same order is re-credited via
 * ADJUSTMENT_REFUND, same as the booking path (and, same as the booking
 * path, before the clawback so the shortfall is judged post-refund).
 *
 * Idempotent — a REVOKED row already present for this order makes the
 * clawback a no-op (via the `!existingRevoke` guard AND the
 * @@unique([type, cafeOrderId]) constraint), so a re-refund or an
 * after() retry can't double-claw. Never drives pointsAvailable
 * negative; a genuine shortfall (earned points already spent) caps the
 * clawback at what's available and raises a PARTIAL_REVOKE_SHORTFALL
 * alert.
 */
export async function revokeCafeRewards(
  cafeOrderId: string,
): Promise<{ revokedPoints: number; refundedPoints: number }> {
  const cfg = await getRewardConfig();

  const earns = await db.rewardTransaction.findMany({
    where: { cafeOrderId, type: "EARNED_CAFE" },
  });
  const existingRevoke = await db.rewardTransaction.findFirst({
    where: { cafeOrderId, type: "REVOKED" },
  });
  const redemption = await db.rewardTransaction.findFirst({
    where: { cafeOrderId, type: "REDEEMED_CAFE" },
  });

  let revokedPoints = 0;
  let refundedPoints = 0;

  // 1. Refund the redemption first (see revokeBookingRewards — the
  //    clawback must judge its shortfall against the post-refund
  //    balance).
  if (redemption) {
    const existingRefund = await db.rewardTransaction.findFirst({
      where: { cafeOrderId, type: "ADJUSTMENT_REFUND" },
    });
    if (!existingRefund) {
      const points = Math.abs(redemption.points);
      const result = await refundRedemption({
        userId: redemption.userId,
        points,
        cafeOrderId,
        reason: "Cafe order refunded — redemption returned",
      });
      if (result.refunded) refundedPoints = points;
    }
  }

  // 2. Clawback the EARNED_CAFE credit (only once).
  if (earns.length > 0 && !existingRevoke) {
    const userId = earns[0].userId;
    const totalEarned = earns.reduce((sum, e) => sum + e.points, 0);
    const balance = await db.rewardBalance.findUnique({
      where: { userId },
    });
    const available = balance?.pointsAvailable ?? 0;
    const wantedClawback = totalEarned;
    const actualClawback = Math.min(available, wantedClawback);
    const shortfall = wantedClawback - actualClawback;
    const sourceTxn = earns[0];

    if (actualClawback > 0) {
      const now = new Date();
      try {
        await db.$transaction(async (tx) => {
          await ensureBalance(tx, userId);
          await tx.rewardTransaction.create({
            data: {
              type: "REVOKED",
              points: -actualClawback,
              pointsValuePaise: -pointsToPaise(actualClawback, cfg),
              userId,
              cafeOrderId,
              sourceTxnId: sourceTxn.id,
              reason:
                shortfall > 0
                  ? `Cafe order refunded — partial clawback (${actualClawback} of ${wantedClawback} points)`
                  : "Cafe order refunded — earn revoked",
            },
          });
          await applyBalanceDelta(tx, {
            userId,
            points: -actualClawback,
            type: "REVOKED",
            now,
          });
        });
        revokedPoints = actualClawback;
      } catch (err) {
        // Idempotency violation = already revoked, treat as success.
        if (!isUniqueViolation(err)) throw err;
      }
    }

    // Flag partial clawbacks once per order — same fully-drained re-run
    // hazard as the booking path above.
    if (shortfall > 0) {
      const openAlerts = await db.rewardAlert.findMany({
        where: { userId, kind: "PARTIAL_REVOKE_SHORTFALL", status: "OPEN" },
        select: { details: true },
      });
      const alreadyFlagged = openAlerts.some(
        (a) =>
          a.details !== null &&
          typeof a.details === "object" &&
          !Array.isArray(a.details) &&
          (a.details as Record<string, unknown>).cafeOrderId === cafeOrderId,
      );
      if (!alreadyFlagged) {
        await db.rewardAlert.create({
          data: {
            userId,
            kind: "PARTIAL_REVOKE_SHORTFALL",
            severity: "MEDIUM",
            status: "OPEN",
            details: {
              cafeOrderId,
              wantedClawback,
              actualClawback,
              shortfall,
              earnTxnId: sourceTxn.id,
            },
          },
        });
      }
    }
  }

  return { revokedPoints, refundedPoints };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}
