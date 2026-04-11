import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { db } from "@/lib/db";
import { createRazorpayOrder, RAZORPAY_KEY_ID } from "@/lib/razorpay";

export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { bookingId, offerId, isAdvance, overrideAmount } = await request.json();

  const booking = await db.booking.findUnique({
    where: { id: bookingId, userId, status: "LOCKED" },
  });

  if (!booking) {
    return NextResponse.json(
      { error: "Booking not found or lock expired" },
      { status: 404 }
    );
  }

  if (booking.lockExpiresAt && booking.lockExpiresAt < new Date()) {
    return NextResponse.json({ error: "Lock expired" }, { status: 410 });
  }

  try {
    // Use overrideAmount (from checkout, includes recurring total / discounts) or fall back to booking amount
    const paymentAmount = overrideAmount && overrideAmount > 0 ? overrideAmount : booking.totalAmount;

    // Calculate amount based on full or advance payment
    let orderAmount = paymentAmount;
    let advanceAmount: number | undefined;
    let remainingAmount: number | undefined;

    if (isAdvance) {
      advanceAmount = Math.ceil(paymentAmount * 0.5);
      remainingAmount = paymentAmount - advanceAmount;
      orderAmount = advanceAmount;
    }

    const order = await createRazorpayOrder(orderAmount, bookingId, offerId);

    await db.payment.upsert({
      where: { bookingId },
      update: {
        method: "RAZORPAY",
        status: "PENDING",
        amount: paymentAmount,
        razorpayOrderId: order.id,
        isPartialPayment: !!isAdvance,
        advanceAmount: advanceAmount || null,
        remainingAmount: remainingAmount || null,
      },
      create: {
        bookingId,
        method: isAdvance ? "CASH" : "RAZORPAY",
        status: "PENDING",
        amount: paymentAmount,
        razorpayOrderId: order.id,
        isPartialPayment: !!isAdvance,
        advanceAmount: advanceAmount || null,
        remainingAmount: remainingAmount || null,
      },
    });

    return NextResponse.json({
      orderId: order.id,
      keyId: RAZORPAY_KEY_ID,
      amount: orderAmount,
      currency: "INR",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create order" },
      { status: 500 }
    );
  }
}
