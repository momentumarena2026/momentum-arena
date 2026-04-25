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
    // v2 merchantOrderId — same shape as the booking initiate route,
    // prefixed CAFE_ so the two streams are distinguishable in
    // PhonePe's dashboard. Column on CafePayment is still legacy-
    // named `phonePeMerchantTxnId` (no schema rename — semantic is
    // identical, just a label change in PhonePe's docs).
    const merchantOrderId = `CAFE_${orderId.slice(-12)}_${Date.now()}`;
    const origin =
      request.headers.get("origin") ||
      process.env.NEXTAUTH_URL ||
      "http://localhost:3000";

    const result = await initiatePhonePePayment({
      merchantOrderId,
      amount: order.totalAmount,
      redirectUrl: `${origin}/api/phonepe/cafe-redirect?orderId=${orderId}`,
      message: `Café order — ₹${(order.totalAmount / 100).toLocaleString("en-IN")}`,
    });

    // Update or create cafe payment
    if (order.payment) {
      await db.cafePayment.update({
        where: { id: order.payment.id },
        data: {
          method: "PHONEPE",
          phonePeMerchantTxnId: merchantOrderId,
        },
      });
    } else {
      await db.cafePayment.create({
        data: {
          orderId,
          method: "PHONEPE",
          status: "PENDING",
          amount: order.totalAmount,
          phonePeMerchantTxnId: merchantOrderId,
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
