import { NextRequest, NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import { checkPhonePeStatus } from "@/lib/phonepe";
import {
  sendBookingConfirmation,
  notifyAdminBookingConfirmed,
} from "@/lib/notifications";
import { createBookingFromHold } from "@/actions/booking";

// PhonePe server-to-server callback (S2S).
// Looks up the pending SlotHold by merchantTransactionId, creates Booking on success.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const base64Response = body.response as string;

    if (!base64Response) {
      return NextResponse.json({ success: false }, { status: 400 });
    }

    const decoded = JSON.parse(
      Buffer.from(base64Response, "base64").toString("utf-8")
    );

    const merchantTransactionId = decoded?.data?.merchantTransactionId;
    if (!merchantTransactionId) {
      return NextResponse.json({ success: false }, { status: 400 });
    }

    // Server-side status verification
    const status = await checkPhonePeStatus(merchantTransactionId);
    if (!status.success) {
      return NextResponse.json({ success: true }); // Acknowledge, don't confirm
    }

    // Idempotency: if payment was already recorded, we're done
    const existingPayment = await db.payment.findFirst({
      where: { phonePeMerchantTxnId: merchantTransactionId },
    });
    if (existingPayment) {
      return NextResponse.json({ success: true });
    }

    // Look up the hold by the merchant txn id
    const hold = await db.slotHold.findUnique({
      where: { phonePeMerchantTxnId: merchantTransactionId },
    });
    if (!hold) {
      return NextResponse.json({ success: true }); // Hold expired or never existed
    }

    const paymentAmount = hold.paymentAmount ?? hold.totalAmount;
    const isAdvance = hold.paymentMethod === "CASH"; // advance-via-phonepe flag
    // fullAmount is POST-discount so the venue isn't told to collect back
    // the coupon. Mirrors the `effectiveTotal` used in createBookingFromHold.
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
        phonePeMerchantTxnId: merchantTransactionId,
        phonePeTransactionId: status.transactionId,
        confirmedAt: new Date(),
        isPartialPayment: isAdvance,
        advanceAmount,
        remainingAmount,
      },
      "CONFIRMED"
    );

    if (bookingId) {
      // Defer SMS dispatch via `after()` so the Vercel serverless function
      // stays alive until MSG91 responds. Fire-and-forget `.catch()` would be
      // killed the moment NextResponse.json returns.
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
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("PhonePe callback error:", error);
    return NextResponse.json({ success: true }); // Always 200 to PhonePe
  }
}
