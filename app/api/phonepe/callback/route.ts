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
      // Failed / pending — acknowledge so PhonePe stops retrying,
      // but don't create anything.
      return NextResponse.json({ success: true });
    }

    // Idempotency: if this order was already recorded, we're done.
    // PhonePe retries on 5xx and on slow responses, so this branch
    // gets exercised regularly in production.
    const existingPayment = await db.payment.findFirst({
      where: { phonePeMerchantTxnId: merchantOrderId },
    });
    if (existingPayment) {
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
      return NextResponse.json({ success: true });
    }

    const paymentAmount = hold.paymentAmount ?? hold.totalAmount;
    const isAdvance = hold.paymentMethod === "CASH"; // advance-via-phonepe flag
    // fullAmount is POST-discount so the venue isn't told to collect
    // back the coupon. Mirrors the `effectiveTotal` used in
    // createBookingFromHold and the redirect handler.
    const appliedDiscount =
      hold.couponId && hold.discountAmount && hold.discountAmount > 0
        ? hold.discountAmount
        : 0;
    const fullAmount = hold.totalAmount - appliedDiscount;
    const advanceAmount = isAdvance ? paymentAmount : undefined;
    const remainingAmount = isAdvance ? fullAmount - paymentAmount : undefined;

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
      // Defer SMS dispatch via `after()` so the Vercel serverless
      // function stays alive until MSG91 responds. Fire-and-forget
      // `.catch()` would be killed the moment NextResponse.json
      // returns.
      after(async () => {
        await Promise.allSettled([
          sendBookingConfirmation(bookingId).catch((err) =>
            console.error("Notification dispatch failed:", err),
          ),
          notifyAdminBookingConfirmed(bookingId).catch((err) =>
            console.error("Notification dispatch failed:", err),
          ),
        ]);
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("PhonePe callback error:", error);
    return NextResponse.json({ success: true }); // Always 200 to PhonePe
  }
}
