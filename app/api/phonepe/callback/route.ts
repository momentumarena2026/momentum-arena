import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkPhonePeStatus } from "@/lib/phonepe";
import { sendBookingConfirmation } from "@/lib/notifications";
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
    const fullAmount = hold.totalAmount;
    const advanceAmount = isAdvance ? paymentAmount : undefined;
    const remainingAmount = isAdvance ? fullAmount - paymentAmount : undefined;

    const bookingId = await createBookingFromHold(
      hold.id,
      {
        method: isAdvance ? "CASH" : "PHONEPE",
        status: "COMPLETED",
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
      sendBookingConfirmation(bookingId).catch(() => {});
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("PhonePe callback error:", error);
    return NextResponse.json({ success: true }); // Always 200 to PhonePe
  }
}
