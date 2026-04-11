import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { db } from "@/lib/db";
import { initiatePhonePePayment } from "@/lib/phonepe";

export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { bookingId, isAdvance, overrideAmount } = await request.json();

  const booking = await db.booking.findUnique({
    where: { id: bookingId, userId, status: "LOCKED" },
    include: { user: true },
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

    let orderAmount = paymentAmount;
    let advanceAmount: number | undefined;
    let remainingAmount: number | undefined;

    if (isAdvance) {
      advanceAmount = Math.ceil(paymentAmount * 0.5);
      remainingAmount = paymentAmount - advanceAmount;
      orderAmount = advanceAmount;
    }

    const merchantTxnId = `MA_${bookingId.slice(-12)}_${Date.now()}`;
    const origin = request.headers.get("origin") || process.env.NEXTAUTH_URL || "http://localhost:3000";

    const result = await initiatePhonePePayment({
      merchantTransactionId: merchantTxnId,
      amount: orderAmount, // already in paise from DB
      callbackUrl: `${origin}/api/phonepe/callback`,
      redirectUrl: `${origin}/api/phonepe/redirect?bookingId=${bookingId}`,
      userPhone: booking.user?.phone || undefined,
    });

    await db.payment.upsert({
      where: { bookingId },
      update: {
        method: "PHONEPE",
        status: "PENDING",
        amount: paymentAmount,
        phonePeMerchantTxnId: merchantTxnId,
        isPartialPayment: !!isAdvance,
        advanceAmount: advanceAmount || null,
        remainingAmount: remainingAmount || null,
      },
      create: {
        bookingId,
        method: isAdvance ? "CASH" : "PHONEPE",
        status: "PENDING",
        amount: paymentAmount,
        phonePeMerchantTxnId: merchantTxnId,
        isPartialPayment: !!isAdvance,
        advanceAmount: advanceAmount || null,
        remainingAmount: remainingAmount || null,
      },
    });

    return NextResponse.json({
      redirectUrl: result.redirectUrl,
    });
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
