import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkPhonePeStatus } from "@/lib/phonepe";
import { sendBookingConfirmation } from "@/lib/notifications";

// PhonePe server-to-server callback (S2S)
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

    // Verify payment status via server-to-server check
    const status = await checkPhonePeStatus(merchantTransactionId);

    if (!status.success) {
      return NextResponse.json({ success: true }); // Acknowledge but don't confirm
    }

    // Find payment by merchantTxnId
    const payment = await db.payment.findFirst({
      where: { phonePeMerchantTxnId: merchantTransactionId },
    });

    if (!payment || payment.status === "COMPLETED") {
      return NextResponse.json({ success: true }); // Already processed or not found
    }

    await db.$transaction([
      db.payment.update({
        where: { id: payment.id },
        data: {
          status: "COMPLETED",
          phonePeTransactionId: status.transactionId,
          confirmedAt: new Date(),
        },
      }),
      db.booking.update({
        where: { id: payment.bookingId },
        data: { status: "CONFIRMED" },
      }),
    ]);

    await sendBookingConfirmation(payment.bookingId).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("PhonePe callback error:", error);
    return NextResponse.json({ success: true }); // Always 200 to PhonePe
  }
}
