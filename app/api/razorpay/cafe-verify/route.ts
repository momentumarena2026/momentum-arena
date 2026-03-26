import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { db } from "@/lib/db";
import { verifyRazorpaySignature } from "@/lib/razorpay";

export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { orderId, razorpayPaymentId, razorpayOrderId, razorpaySignature } =
    await request.json();

  const payment = await db.cafePayment.findFirst({
    where: { order: { id: orderId } },
    include: { order: true },
  });

  if (!payment || payment.order.userId !== userId) {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }

  // Verify signature
  const isValid = verifyRazorpaySignature(
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature
  );

  if (!isValid) {
    return NextResponse.json(
      { error: "Invalid payment signature" },
      { status: 400 }
    );
  }

  await db.cafePayment.update({
    where: { id: payment.id },
    data: {
      status: "COMPLETED",
      razorpayPaymentId,
      razorpaySignature,
      confirmedAt: new Date(),
    },
  });

  return NextResponse.json({ success: true });
}
