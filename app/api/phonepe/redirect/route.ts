import { NextRequest, NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import { checkPhonePeStatus } from "@/lib/phonepe";
import {
  sendBookingConfirmation,
  notifyAdminBookingConfirmed,
} from "@/lib/notifications";
import { createBookingFromHold } from "@/actions/booking";
import { awardBookingPoints } from "@/lib/rewards/earn";
import { AnalyticsCategory, logServerAction } from "@/lib/server-log";

// PhonePe redirects the user back here after the payment flow.
// Check the status, and if success, create Booking atomically from the Hold.
export async function GET(request: NextRequest) {
  const holdId = request.nextUrl.searchParams.get("holdId");
  const origin =
    request.headers.get("origin") ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000";

  if (!holdId) {
    return NextResponse.redirect(`${origin}/book?error=missing_hold`);
  }

  try {
    const hold = await db.slotHold.findUnique({ where: { id: holdId } });

    // Hold is gone → S2S callback already consumed it. Find the resulting Booking.
    if (!hold) {
      // PhonePe merchant txn id pattern: MA_{holdSuffix}_{timestamp}. The S2S
      // callback stored that on Payment. We look up the booking by the suffix.
      const payment = await db.payment.findFirst({
        where: {
          phonePeMerchantTxnId: { contains: holdId.slice(-12) },
          status: "COMPLETED",
        },
        orderBy: { createdAt: "desc" },
        include: { booking: { select: { userId: true } } },
      });
      if (payment) {
        logServerAction({
          userId: payment.booking.userId,
          category: AnalyticsCategory.PAYMENT,
          action: "payment.phonepe.redirect",
          outcome: "success",
          path: request.nextUrl.pathname,
          method: "GET",
          platform: "web",
          metadata: {
            holdId,
            bookingId: payment.bookingId,
            idempotent: true,
            via: "callback_race",
          },
        });
        return NextResponse.redirect(
          `${origin}/book/confirmation?id=${payment.bookingId}`
        );
      }
      logServerAction({
        category: AnalyticsCategory.PAYMENT,
        action: "payment.phonepe.redirect",
        outcome: "error",
        path: request.nextUrl.pathname,
        method: "GET",
        platform: "web",
        metadata: { holdId },
        error: "Hold expired",
      });
      return NextResponse.redirect(`${origin}/book?error=hold_expired`);
    }

    if (!hold.phonePeMerchantTxnId) {
      logServerAction({
        userId: hold.userId,
        category: AnalyticsCategory.PAYMENT,
        action: "payment.phonepe.redirect",
        outcome: "error",
        path: request.nextUrl.pathname,
        method: "GET",
        platform: "web",
        metadata: { holdId },
        error: "Payment not found on hold",
      });
      return NextResponse.redirect(`${origin}/book?error=payment_not_found`);
    }

    const status = await checkPhonePeStatus(hold.phonePeMerchantTxnId);

    if (status.success) {
      const paymentAmount = hold.paymentAmount ?? hold.totalAmount;
      const isAdvance = hold.paymentMethod === "CASH";
      // fullAmount is POST-discount (coupon + points redemption) — same
      // reasoning as razorpay/verify and phonepe/callback. Pre-discount
      // here made the venue collect the coupon back from the customer.
      const appliedDiscount =
        hold.couponId && hold.discountAmount && hold.discountAmount > 0
          ? hold.discountAmount
          : 0;
      const pointsRedeemRupees =
        hold.pointsToRedeem && hold.pointsRedeemPaiseSaved
          ? Math.floor(hold.pointsRedeemPaiseSaved / 100)
          : 0;
      // Gear picked at lock time is PLUSed on top of the slot total — the
      // same `effectiveTotal` math createBookingFromHold uses for
      // Booking.totalAmount. Leaving it out understated remainingAmount by
      // the equipment total, so "Due at Venue" was less than the counter asks.
      const fullAmount =
        hold.totalAmount -
        appliedDiscount -
        pointsRedeemRupees +
        (hold.equipmentTotalAmount ?? 0);
      const advanceAmount = isAdvance ? paymentAmount : undefined;
      const remainingAmount = isAdvance
        ? fullAmount - paymentAmount
        : undefined;

      const bookingId = await createBookingFromHold(
        hold.id,
        {
          method: "PHONEPE",
          status: isAdvance ? "PARTIAL" : "COMPLETED",
          amount: paymentAmount,
          phonePeMerchantTxnId: hold.phonePeMerchantTxnId,
          phonePeTransactionId: status.transactionId,
          confirmedAt: new Date(),
          isPartialPayment: isAdvance,
          advanceAmount,
          remainingAmount,
        },
        "CONFIRMED"
      );

      if (!bookingId) {
        // The hold race-condition consumed the hold via the S2S callback.
        // Look up the booking by the merchant txn id.
        const payment = await db.payment.findFirst({
          where: { phonePeMerchantTxnId: hold.phonePeMerchantTxnId },
        });
        if (payment) {
          logServerAction({
            userId: hold.userId,
            category: AnalyticsCategory.PAYMENT,
            action: "payment.phonepe.redirect",
            outcome: "success",
            path: request.nextUrl.pathname,
            method: "GET",
            platform: "web",
            metadata: {
              holdId,
              bookingId: payment.bookingId,
              merchantOrderId: hold.phonePeMerchantTxnId,
              idempotent: true,
              via: "redirect_race",
            },
          });
          return NextResponse.redirect(
            `${origin}/book/confirmation?id=${payment.bookingId}`
          );
        }
        logServerAction({
          userId: hold.userId,
          category: AnalyticsCategory.PAYMENT,
          action: "payment.phonepe.redirect",
          outcome: "error",
          path: request.nextUrl.pathname,
          method: "GET",
          platform: "web",
          metadata: {
            holdId,
            merchantOrderId: hold.phonePeMerchantTxnId,
          },
          error: "Failed to create booking",
        });
        return NextResponse.redirect(`${origin}/book?error=payment_failed`);
      }

      // Defer SMS dispatch via `after()` so the Vercel serverless function
      // stays alive until MSG91 responds. Fire-and-forget `.catch()` would be
      // killed the moment NextResponse.redirect returns.
      //
      // awardBookingPoints rides the same window. The redirect path is
      // a fallback when the S2S callback hasn't won the race; if S2S
      // already awarded points the idempotency constraint
      // (@@unique([type, bookingId])) makes this a no-op.
      after(async () => {
        await Promise.allSettled([
          sendBookingConfirmation(bookingId).catch((err) =>
            console.error("Notification dispatch failed:", err)
          ),
          notifyAdminBookingConfirmed(bookingId).catch((err) =>
            console.error("Notification dispatch failed:", err)
          ),
          awardBookingPoints(bookingId).catch((err) =>
            console.error("[rewards] award failed for", bookingId, err)
          ),
        ]);
      });
      logServerAction({
        userId: hold.userId,
        category: AnalyticsCategory.PAYMENT,
        action: "payment.phonepe.redirect",
        outcome: "success",
        path: request.nextUrl.pathname,
        method: "GET",
        platform: "web",
        metadata: {
          holdId,
          bookingId,
          merchantOrderId: hold.phonePeMerchantTxnId,
          amount: paymentAmount,
          isAdvance,
        },
      });
      return NextResponse.redirect(`${origin}/book/confirmation?id=${bookingId}`);
    }

    // Payment failed / pending on PhonePe side → hold expires naturally
    logServerAction({
      userId: hold.userId,
      category: AnalyticsCategory.PAYMENT,
      action: "payment.phonepe.redirect",
      outcome: "error",
      path: request.nextUrl.pathname,
      method: "GET",
      platform: "web",
      metadata: {
        holdId,
        merchantOrderId: hold.phonePeMerchantTxnId,
        phonePeState: status.state,
      },
      error: `Payment ${status.state.toLowerCase()}`,
    });
    return NextResponse.redirect(
      `${origin}/book?error=payment_${status.state.toLowerCase()}`
    );
  } catch (error) {
    console.error("PhonePe redirect error:", error);
    logServerAction({
      category: AnalyticsCategory.PAYMENT,
      action: "payment.phonepe.redirect",
      outcome: "error",
      path: request.nextUrl.pathname,
      method: "GET",
      platform: "web",
      metadata: { holdId },
      error: error instanceof Error ? error.message : "Payment failed",
    });
    return NextResponse.redirect(`${origin}/book?error=payment_failed`);
  }
}
