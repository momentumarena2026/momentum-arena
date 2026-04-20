import { NextRequest, NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import { checkPhonePeStatus } from "@/lib/phonepe";
import {
  sendBookingConfirmation,
  notifyAdminBookingConfirmed,
} from "@/lib/notifications";
import { createBookingFromHold } from "@/actions/booking";

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
      });
      if (payment) {
        return NextResponse.redirect(
          `${origin}/book/confirmation?id=${payment.bookingId}`
        );
      }
      return NextResponse.redirect(`${origin}/book?error=hold_expired`);
    }

    if (!hold.phonePeMerchantTxnId) {
      return NextResponse.redirect(`${origin}/book?error=payment_not_found`);
    }

    const status = await checkPhonePeStatus(hold.phonePeMerchantTxnId);

    if (status.success) {
      const paymentAmount = hold.paymentAmount ?? hold.totalAmount;
      const isAdvance = hold.paymentMethod === "CASH";
      const fullAmount = hold.totalAmount;
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
          return NextResponse.redirect(
            `${origin}/book/confirmation?id=${payment.bookingId}`
          );
        }
        return NextResponse.redirect(`${origin}/book?error=payment_failed`);
      }

      // Defer SMS dispatch via `after()` so the Vercel serverless function
      // stays alive until MSG91 responds. Fire-and-forget `.catch()` would be
      // killed the moment NextResponse.redirect returns.
      after(async () => {
        await Promise.allSettled([
          sendBookingConfirmation(bookingId).catch((err) =>
            console.error("Notification dispatch failed:", err)
          ),
          notifyAdminBookingConfirmed(bookingId).catch((err) =>
            console.error("Notification dispatch failed:", err)
          ),
        ]);
      });
      return NextResponse.redirect(`${origin}/book/confirmation?id=${bookingId}`);
    }

    // Payment failed / pending on PhonePe side → hold expires naturally
    return NextResponse.redirect(
      `${origin}/book?error=payment_${status.state.toLowerCase()}`
    );
  } catch (error) {
    console.error("PhonePe redirect error:", error);
    return NextResponse.redirect(`${origin}/book?error=payment_failed`);
  }
}
