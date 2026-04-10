import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { initiatePhonePePayment } from "@/lib/phonepe";

export async function POST(request: NextRequest) {
  const { orderId } = await request.json();

  const order = await db.cafeOrder.findUnique({
    where: { id: orderId },
    include: { payment: true },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  try {
    const merchantTxnId = `CAFE_${orderId.slice(-12)}_${Date.now()}`;
    const origin =
      request.headers.get("origin") ||
      process.env.NEXTAUTH_URL ||
      "http://localhost:3000";

    const result = await initiatePhonePePayment({
      merchantTransactionId: merchantTxnId,
      amount: order.totalAmount,
      callbackUrl: `${origin}/api/phonepe/cafe-callback`,
      redirectUrl: `${origin}/api/phonepe/cafe-redirect?orderId=${orderId}`,
    });

    // Update or create cafe payment
    if (order.payment) {
      await db.cafePayment.update({
        where: { id: order.payment.id },
        data: {
          method: "PHONEPE",
          phonePeMerchantTxnId: merchantTxnId,
        },
      });
    } else {
      await db.cafePayment.create({
        data: {
          orderId,
          method: "PHONEPE",
          status: "PENDING",
          amount: order.totalAmount,
          phonePeMerchantTxnId: merchantTxnId,
        },
      });
    }

    return NextResponse.json({ redirectUrl: result.redirectUrl });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to initiate payment",
      },
      { status: 500 }
    );
  }
}
