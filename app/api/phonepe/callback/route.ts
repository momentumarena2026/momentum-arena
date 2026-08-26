import { remainderAfterAdvance } from "@/lib/booking-amounts";
import { NextRequest, NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import {
  checkPhonePeStatus,
  verifyPhonePeWebhook,
  type PhonePeWebhookBody,
} from "@/lib/phonepe";
import {
  sendBookingConfirmation,
  notifyAdminBookingConfirmed,
} from "@/lib/notifications";
import { createBookingFromHold } from "@/actions/booking";
import { awardBookingPoints } from "@/lib/rewards/earn";
import { AnalyticsCategory, logServerAction } from "@/lib/server-log";
import { recordOrphanPayment } from "@/lib/payment-orphan";

/**
 * PhonePe v2 server-to-server webhook for booking payments.
 *
 * Auth: PhonePe sets `Authorization: SHA256(username:password)`
 * where username/password are configured in the dashboard's
 * Webhooks tab and stored in PHONEPE_WEBHOOK_USERNAME /
 * PHONEPE_WEBHOOK_PASSWORD. We reject anything that doesn't match.
 *
 * Body (v2):
 *   { event: "checkout.order.completed" | …, payload: { merchantOrderId, state, … } }
 *
 * The webhook is the primary booking-creation path — the user
 * redirect handler at /api/phonepe/redirect is the secondary,
 * and either path is allowed to win. Idempotency is enforced by
 * checking Payment by `phonePeMerchantTxnId` before creating the
 * booking.
 */
export async function POST(request: NextRequest) {
  try {
    // Verify auth FIRST so we never log/process a forged payload.
    const authHeader = request.headers.get("authorization");
    if (!verifyPhonePeWebhook(authHeader)) {
      console.warn("PhonePe webhook: auth header mismatch");
      return NextResponse.json({ success: false }, { status: 401 });
    }

    const body = (await request.json()) as PhonePeWebhookBody;
    const merchantOrderId = body.payload?.merchantOrderId;

    if (!merchantOrderId) {
      return NextResponse.json({ success: false }, { status: 400 });
    }

    // Defense-in-depth: even though the webhook is authenticated,
    // we still hit PhonePe's status API to confirm the order's
    // settled state before we create a Booking. The webhook payload
    // already tells us this, but a fresh poll defends against a
    // replayed-stale-event class of bug.
    const status = await checkPhonePeStatus(merchantOrderId);
    if (!status.success) {
      logServerAction({
        category: AnalyticsCategory.PAYMENT,
        action: "payment.phonepe.callback",
        outcome: "error",
        path: request.nextUrl.pathname,
        method: "POST",
        platform: "web",
        metadata: { merchantOrderId, phonePeState: status.state },
        error: `Payment ${status.state.toLowerCase()}`,
      });
      // Failed / pending — acknowledge so PhonePe stops retrying,
      // but don't create anything.
      return NextResponse.json({ success: true });
    }

    // Idempotency: if this order was already recorded, we're done.
    // PhonePe retries on 5xx and on slow responses, so this branch
    // gets exercised regularly in production.
    const existingPayment = await db.payment.findFirst({
      where: { phonePeMerchantTxnId: merchantOrderId },
      include: { booking: { select: { userId: true } } },
    });
    if (existingPayment) {
      logServerAction({
        userId: existingPayment.booking.userId,
        category: AnalyticsCategory.PAYMENT,
        action: "payment.phonepe.callback",
        outcome: "success",
        path: request.nextUrl.pathname,
        method: "POST",
        platform: "web",
        metadata: {
          merchantOrderId,
          bookingId: existingPayment.bookingId,
          idempotent: true,
        },
      });
      return NextResponse.json({ success: true });
    }

    // Look up the hold by the merchant order id we stored on
    // initiate. If the hold has already been consumed (rare race —
    // the redirect handler beat us to it), we'll find a Payment
    // above on the next retry; for now ack and move on.
    const hold = await db.slotHold.findUnique({
      where: { phonePeMerchantTxnId: merchantOrderId },
    });
    if (!hold) {
      // We already confirmed status.success (capture certain) AND found no
      // existing Payment above. So this is NOT a benign "redirect won the
      // race" case — the hold blueprint is genuinely gone (swept past the
      // 24h grace) and no booking exists. That's an orphaned captured
      // payment; record it so an admin honours/refunds it.
      recordOrphanPayment({
        gateway: "PHONEPE",
        reason: "no-hold",
        phonePeMerchantTxnId: merchantOrderId,
        path: request.nextUrl.pathname,
      });
      logServerAction({
        category: AnalyticsCategory.PAYMENT,
        action: "payment.phonepe.callback",
        outcome: "error",
        path: request.nextUrl.pathname,
        method: "POST",
        platform: "web",
        metadata: { merchantOrderId, orphan: true },
        error: "Hold gone (payment captured — orphaned)",
      });
      return NextResponse.json({ success: true });
    }

    const paymentAmount = hold.paymentAmount ?? hold.totalAmount;
    const isAdvance = hold.paymentMethod === "CASH"; // advance-via-phonepe flag
    // fullAmount is POST-discount (coupon + points redemption) so the
    // venue isn't told to collect back either discount. Mirrors the
    // `combinedDiscount` math inside createBookingFromHold and the
    // redirect handler.
    const appliedDiscount =
      hold.couponId && hold.discountAmount && hold.discountAmount > 0
        ? hold.discountAmount
        : 0;
    const pointsRedeemRupees =
      hold.pointsToRedeem && hold.pointsRedeemPaiseSaved
        ? Math.floor(hold.pointsRedeemPaiseSaved / 100)
        : 0;
    // Gear picked at lock time is PLUSed on top of the slot total — the same
    // `effectiveTotal` math createBookingFromHold uses for Booking.totalAmount.
    // Leaving it out understated remainingAmount by the equipment total, so
    // the venue was told to collect less than markRemainderCollected demands.
    const fullAmount =
      hold.totalAmount -
      appliedDiscount -
      pointsRedeemRupees +
      (hold.equipmentTotalAmount ?? 0);
    const advanceAmount = isAdvance ? paymentAmount : undefined;
    const remainingAmount = isAdvance
      ? remainderAfterAdvance(fullAmount, paymentAmount)
      : undefined;

    const bookingId = await createBookingFromHold(
      hold.id,
      {
        method: "PHONEPE",
        status: isAdvance ? "PARTIAL" : "COMPLETED",
        amount: paymentAmount,
        phonePeMerchantTxnId: merchantOrderId,
        phonePeTransactionId: status.transactionId,
        confirmedAt: new Date(),
        isPartialPayment: isAdvance,
        advanceAmount,
        remainingAmount,
      },
      "CONFIRMED",
    );

    if (bookingId) {
      logServerAction({
        userId: hold.userId,
        category: AnalyticsCategory.PAYMENT,
        action: "payment.phonepe.callback",
        outcome: "success",
        path: request.nextUrl.pathname,
        method: "POST",
        platform: "web",
        metadata: {
          holdId: hold.id,
          bookingId,
          merchantOrderId,
          amount: paymentAmount,
          isAdvance,
        },
      });
      // Defer SMS dispatch via `after()` so the Vercel serverless
      // function stays alive until MSG91 responds. Fire-and-forget
      // `.catch()` would be killed the moment NextResponse.json
      // returns.
      //
      // awardBookingPoints rides the same window — the rewards
      // ledger was orphaning every PhonePe-paid booking the same
      // way the Razorpay verify routes did before #99. Idempotent
      // + self-gated on booking.status === "CONFIRMED".
      after(async () => {
        await Promise.allSettled([
          sendBookingConfirmation(bookingId).catch((err) =>
            console.error("Notification dispatch failed:", err),
          ),
          notifyAdminBookingConfirmed(bookingId).catch((err) =>
            console.error("Notification dispatch failed:", err),
          ),
          awardBookingPoints(bookingId).catch((err) =>
            console.error("[rewards] award failed for", bookingId, err),
          ),
        ]);
      });
    } else {
      logServerAction({
        userId: hold.userId,
        category: AnalyticsCategory.PAYMENT,
        action: "payment.phonepe.callback",
        outcome: "error",
        path: request.nextUrl.pathname,
        method: "POST",
        platform: "web",
        metadata: { holdId: hold.id, merchantOrderId },
        error: "Failed to create booking",
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("PhonePe callback error:", error);
    logServerAction({
      category: AnalyticsCategory.PAYMENT,
      action: "payment.phonepe.callback",
      outcome: "error",
      path: request.nextUrl.pathname,
      method: "POST",
      platform: "web",
      error: error instanceof Error ? error.message : "Callback error",
    });
    return NextResponse.json({ success: true }); // Always 200 to PhonePe
  }
}
