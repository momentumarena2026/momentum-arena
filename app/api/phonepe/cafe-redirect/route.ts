import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkPhonePeStatus } from "@/lib/phonepe";

export async function GET(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get("orderId");
  const origin =
    request.headers.get("origin") ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000";

  if (!orderId) {
    return NextResponse.redirect(`${origin}/cafe?error=missing_order`);
  }

  try {
    const payment = await db.cafePayment.findUnique({
      where: { orderId },
    });

    if (!payment?.phonePeMerchantTxnId) {
      return NextResponse.redirect(`${origin}/cafe?error=payment_not_found`);
    }

    if (payment.status === "COMPLETED") {
      return NextResponse.redirect(
        `${origin}/cafe/confirmation/${orderId}`
      );
    }

    const status = await checkPhonePeStatus(payment.phonePeMerchantTxnId);

    if (status.success) {
      await db.cafePayment.update({
        where: { id: payment.id },
        data: {
          status: "COMPLETED",
          phonePeTransactionId: status.transactionId,
          confirmedAt: new Date(),
        },
      });

      return NextResponse.redirect(
        `${origin}/cafe/confirmation/${orderId}`
      );
    }

    return NextResponse.redirect(
      `${origin}/cafe?error=payment_${status.state.toLowerCase()}`
    );
  } catch (error) {
    console.error("PhonePe cafe redirect error:", error);
    return NextResponse.redirect(`${origin}/cafe?error=payment_failed`);
  }
}
