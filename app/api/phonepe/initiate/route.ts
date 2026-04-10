import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { db } from "@/lib/db";
import { initiatePhonePePayment } from "@/lib/phonepe";

export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { bookingId, isAdvance } = await request.json();

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
    let orderAmount = booking.totalAmount; // in paise
    let advanceAmount: number | undefined;
    let remainingAmount: number | undefined;

    if (isAdvance) {
      advanceAmount = Math.ceil(booking.totalAmount * 0.2);
      remainingAmount = booking.totalAmount - advanceAmount;
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
        amount: booking.totalAmount,
        phonePeMerchantTxnId: merchantTxnId,
        isPartialPayment: !!isAdvance,
        advanceAmount: advanceAmount || null,
        remainingAmount: remainingAmount || null,
      },
      create: {
        bookingId,
        method: isAdvance ? "CASH" : "PHONEPE",
        status: "PENDING",
        amount: booking.totalAmount,
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
