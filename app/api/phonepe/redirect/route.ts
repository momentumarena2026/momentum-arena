import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkPhonePeStatus } from "@/lib/phonepe";
import { sendBookingConfirmation } from "@/lib/notifications";

// PhonePe redirects user back here after payment
export async function GET(request: NextRequest) {
  const bookingId = request.nextUrl.searchParams.get("bookingId");
  const origin = request.headers.get("origin") || process.env.NEXTAUTH_URL || "http://localhost:3000";

  if (!bookingId) {
    return NextResponse.redirect(`${origin}/book?error=missing_booking`);
  }

  try {
    const payment = await db.payment.findUnique({
      where: { bookingId },
    });

    if (!payment?.phonePeMerchantTxnId) {
      return NextResponse.redirect(`${origin}/book?error=payment_not_found`);
    }

    // If callback already confirmed it, go straight to confirmation
    if (payment.status === "COMPLETED") {
      return NextResponse.redirect(
        `${origin}/book/confirmation/${bookingId}`
      );
    }

    // Check payment status (callback may not have arrived yet)
    const status = await checkPhonePeStatus(payment.phonePeMerchantTxnId);

    if (status.success) {
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
          where: { id: bookingId },
          data: { status: "CONFIRMED" },
        }),
      ]);

      await sendBookingConfirmation(bookingId).catch(() => {});

      return NextResponse.redirect(
        `${origin}/book/confirmation/${bookingId}`
      );
    }

    // Payment failed or pending
    return NextResponse.redirect(
      `${origin}/book?error=payment_${status.state.toLowerCase()}`
    );
  } catch (error) {
    console.error("PhonePe redirect error:", error);
    return NextResponse.redirect(`${origin}/book?error=payment_failed`);
  }
}
