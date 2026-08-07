import { NextRequest, NextResponse, after } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { getValidHold } from "@/lib/slot-hold";
import { createBookingFromHold } from "@/actions/booking";
import {
  notifyAdminPendingBooking,
  notifyAdminPendingManualPayment,
} from "@/lib/notifications";
import { probeUntilSettled } from "@/lib/dqr-inflight";
import { db } from "@/lib/db";
import { confirmDqrBooking, confirmDqrCafe } from "@/lib/dqr-confirm";
import { confirmDqrPass, PASS_MISMATCH_MESSAGE } from "@/lib/passes";
import {
  AnalyticsCategory,
  logServerAction,
  resolveRequestPlatform,
} from "@/lib/server-log";

/**
 * "I've paid" — reserve the slot while PhonePe catches up.
 *
 * PhonePe can leave a genuinely-paid intent transaction PENDING
 * indefinitely (the intent-replication gap). The customer's money is
 * gone, but we can't prove it, so we can't confirm the booking. Doing
 * nothing loses them the slot AND the money's trail.
 *
 * This mirrors the static-QR flow that predates DQR: create the booking
 * UNCONFIRMED (Booking PENDING + Payment PENDING) so the slot is held
 * and the admin's existing unconfirmed-bookings queue and notifications
 * pick it up for manual verification.
 *
 * Two things make it safer than the static-QR version it copies:
 *
 *  1. It is NOT a bare trust button. We only accept the claim when this
 *     hold actually carries an in-flight DQR transaction that PhonePe
 *     reports as PENDING. Nobody can mint an unconfirmed booking by
 *     tapping "I've paid" without a real payment attempt behind it, and
 *     if PhonePe says COMPLETED we confirm properly instead.
 *  2. The transaction id is stamped on the Payment row, so a late
 *     settlement (callback or poll) upgrades the booking to CONFIRMED
 *     automatically — see confirmDqrBooking — and an admin can verify
 *     it against the PhonePe dashboard by id rather than a screenshot.
 */
export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { holdId, overrideAmount, surface, transactionId } = await request
    .json()
    .catch(() => ({}));

  // ── Cafe / pass: claim the INTENT, don't materialise anything ──
  // Resolved by TRANSACTION id, not `holdId` — on these surfaces holdId
  // carries the plan/cart reference, not the intent's own id.
  if (surface === "cafe" || surface === "pass") {
    if (!transactionId) {
      return NextResponse.json(
        { error: "Missing transactionId" },
        { status: 400 },
      );
    }
    const intent =
      surface === "cafe"
        ? await db.cafePaymentIntent.findUnique({
            where: { phonePeMerchantTxnId: transactionId },
            select: { id: true, userId: true, phonePeMerchantTxnId: true, consumedOrderId: true },
          })
        : await db.passPurchaseIntent.findUnique({
            where: { phonePeMerchantTxnId: transactionId },
            select: { id: true, userId: true, phonePeMerchantTxnId: true, consumedUserPassId: true },
          });
    if (!intent || (intent.userId && intent.userId !== userId)) {
      return NextResponse.json({ error: "Purchase not found" }, { status: 404 });
    }
    const consumed =
      surface === "cafe"
        ? (intent as { consumedOrderId: string | null }).consumedOrderId
        : (intent as { consumedUserPassId: string | null }).consumedUserPassId;
    if (consumed) {
      return NextResponse.json({ id: consumed, confirmed: true });
    }
    const intentTxn = intent.phonePeMerchantTxnId;
    if (!intentTxn) {
      return NextResponse.json(
        { error: "No UPI payment was started for this purchase." },
        { status: 409 },
      );
    }
    // Try to settle it properly FIRST — poll PhonePe for a few seconds
    // rather than taking one PENDING as final. Most "stuck" payments
    // resolve here and never reach a human.
    {
      const status = await probeUntilSettled(intentTxn);
      if (status.state === "COMPLETED") {
        if (surface === "cafe") {
          const done = await confirmDqrCafe(intentTxn, status.providerReferenceId);
          if (done.orderId) {
            return NextResponse.json({ id: done.orderId, confirmed: true });
          }
        } else {
          // confirmDqrPass price-checks the capture, and calling it with
          // no amount is TERMINAL: it stamps the mismatch sentinel on the
          // intent, which withholds the pass AND hides the claim from both
          // admin queues (they match consumedUserPassId: null). So only
          // confirm when the probe actually carried an amount back —
          // without it, falling through to the manual queue is correct.
          const capturedPaise = status.amount;
          if (capturedPaise !== undefined) {
            const done = await confirmDqrPass(
              intentTxn,
              status.providerReferenceId,
              capturedPaise,
            );
            if (done.userPassId) {
              return NextResponse.json({ id: done.userPassId, confirmed: true });
            }
            if (done.mismatch) {
              // Terminal, and confirmDqrPass has already filed the orphan.
              // The intent can no longer surface in the admin queue, so the
              // customer must be told here rather than given the "our team
              // will confirm it shortly" line below. Logged here too: this
              // exit skips the shared log at the end of the branch, and a
              // price mismatch is exactly the case analytics must see.
              logServerAction({
                userId,
                category: AnalyticsCategory.PAYMENT,
                action: "payment.dqr.claimed-paid",
                outcome: "error",
                path: request.nextUrl.pathname,
                method: "POST",
                platform: resolveRequestPlatform(request),
                metadata: {
                  surface,
                  intentId: intent.id,
                  transactionId: intentTxn,
                  capturedPaise,
                  mismatch: true,
                },
                error: PASS_MISMATCH_MESSAGE,
              });
              return NextResponse.json({
                confirmed: false,
                paymentReceived: true,
                error: PASS_MISMATCH_MESSAGE,
              });
            }
          }
        }
      }
    }
    if (surface === "cafe") {
      await db.cafePaymentIntent.update({
        where: { id: intent.id },
        data: { claimedAt: new Date() },
      });
    } else {
      await db.passPurchaseIntent.update({
        where: { id: intent.id },
        data: { claimedAt: new Date() },
      });
    }
    // Tell the admins, exactly as the booking path does. This branch
    // returns before notifyAdminPendingBooking further down, so without
    // this a pass or cafe claim sat in the unconfirmed queue in silence.
    //
    // Inside after() for the same reason as the booking call: a bare
    // promise is killed when the function freezes on response.
    after(async () => {
      const claimant = await db.user
        .findUnique({ where: { id: userId }, select: { name: true, phone: true } })
        .catch(() => null);
      await notifyAdminPendingManualPayment(
        surface === "cafe" ? "cafe" : "pass",
        claimant?.name || claimant?.phone || "A customer",
      ).catch((err) =>
        console.error(`[dqr] admin pending ${surface} notify failed`, err),
      );
    });
    logServerAction({
      userId,
      category: AnalyticsCategory.PAYMENT,
      action: "payment.dqr.claimed-paid",
      outcome: "success",
      path: request.nextUrl.pathname,
      method: "POST",
      platform: resolveRequestPlatform(request),
      metadata: { surface, intentId: intent.id, transactionId: intentTxn },
    });
    return NextResponse.json({ claimed: true, confirmed: false });
  }

  if (!holdId) {
    return NextResponse.json({ error: "Missing holdId" }, { status: 400 });
  }

  const hold = await getValidHold(holdId, userId);
  if (!hold) {
    return NextResponse.json(
      { error: "This reservation has expired. Please contact us — do NOT pay again." },
      { status: 404 },
    );
  }
  const txn = hold.phonePeMerchantTxnId;
  if (!txn?.startsWith("DQR_")) {
    return NextResponse.json(
      { error: "No UPI payment was started for this booking." },
      { status: 409 },
    );
  }

  // Try to settle it properly FIRST: a confirmed booking beats an
  // unconfirmed one every time, and one PENDING answer isn't proof —
  // UPI settlement often lands seconds after the customer gets back.
  // Only a payment PhonePe still won't acknowledge falls through to the
  // manual queue.
  {
    const status = await probeUntilSettled(txn);
    if (status.state === "COMPLETED") {
      const confirmed = await confirmDqrBooking(txn, status.providerReferenceId);
      if (confirmed.bookingId) {
        return NextResponse.json({
          bookingId: confirmed.bookingId,
          confirmed: true,
        });
      }
    }
    if (status.state === "FAILED") {
      return NextResponse.json(
        {
          error:
            "Your bank reported this payment as failed. If money did leave your account, please contact us instead of paying again.",
        },
        { status: 409 },
      );
    }
  }

  const isAdvance = hold.paymentMethod === "CASH";
  // fullAmount is POST-discount (coupon + points redemption) and PLUS the
  // gear locked with the hold — the same `effectiveTotal` math
  // createBookingFromHold uses for Booking.totalAmount. Omitting equipment
  // understated remainingAmount by the whole gear total, so the venue was
  // told to collect less than the booking says is due. Same math as
  // phonepe/callback, razorpay/verify and dqr-confirm.
  const appliedDiscount =
    hold.couponId && hold.discountAmount && hold.discountAmount > 0
      ? hold.discountAmount
      : 0;
  const pointsRedeemRupees =
    hold.pointsToRedeem && hold.pointsRedeemPaiseSaved
      ? Math.floor(hold.pointsRedeemPaiseSaved / 100)
      : 0;
  const fullAmount = Math.max(
    0,
    hold.totalAmount -
      appliedDiscount -
      pointsRedeemRupees +
      (hold.equipmentTotalAmount ?? 0),
  );

  // Derived from the hold, never from the request body. hold.paymentAmount
  // is what dqr/initiate actually minted the QR for; the server-side
  // fullAmount is the only fallback. `overrideAmount` from the client is
  // the FULL payable (the same value initiate receives and then halves for
  // the 50%-advance option), so preferring it recorded the whole booking as
  // paid and left the venue collecting ₹0 on every advance claim — and a
  // tampered client could name any figure. It is logged only so
  // client/server drift stays visible.
  const amount = hold.paymentAmount ?? fullAmount;

  const bookingId = await createBookingFromHold(
    holdId,
    {
      method: "UPI_QR",
      status: "PENDING",
      amount,
      phonePeMerchantTxnId: txn,
      ...(isAdvance
        ? {
            isPartialPayment: true,
            advanceAmount: amount,
            remainingAmount: Math.max(fullAmount - amount, 0),
          }
        : {}),
    },
    "PENDING",
  );
  if (!bookingId) {
    return NextResponse.json(
      {
        error:
          "We couldn't reserve this slot — it may have just been taken. Please do NOT pay again; contact us and we'll sort it out.",
      },
      { status: 409 },
    );
  }

  // MUST be inside after(): a bare fire-and-forget promise is killed
  // when the serverless function freezes on response, so the admin SMS
  // only landed when it happened to win that race. Every other
  // notification path in the codebase already does this.
  after(async () => {
    await notifyAdminPendingBooking(bookingId).catch((err) =>
      console.error("[dqr] admin pending-booking notify failed", err),
    );
  });
  logServerAction({
    userId,
    category: AnalyticsCategory.PAYMENT,
    action: "payment.dqr.claimed-paid",
    outcome: "success",
    path: request.nextUrl.pathname,
    method: "POST",
    platform: resolveRequestPlatform(request),
    metadata: {
      holdId,
      bookingId,
      transactionId: txn,
      amount,
      clientAmount: overrideAmount ?? null,
    },
  });

  return NextResponse.json({ bookingId, confirmed: false });
}
