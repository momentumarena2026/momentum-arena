import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { db } from "@/lib/db";
import { createRazorpayOrder, RAZORPAY_KEY_ID } from "@/lib/razorpay";
import { getValidHold } from "@/lib/slot-hold";
import { LOCK_TTL_MINUTES } from "@/lib/court-config";

const PAYMENT_ATTEMPT_TTL_MINUTES = 15;

export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { holdId, offerId, isAdvance, overrideAmount } = await request.json();

  if (!holdId) {
    return NextResponse.json({ error: "Missing holdId" }, { status: 400 });
  }

  const hold = await getValidHold(holdId, userId);
  if (!hold) {
    return NextResponse.json(
      { error: "Hold not found or expired" },
      { status: 404 }
    );
  }

  try {
    // overrideAmount accounts for discounts/recurring total
    const paymentAmount =
      overrideAmount && overrideAmount > 0 ? overrideAmount : hold.totalAmount;

    // Advance payment splits the amount: 50% online, remainder at venue
    let orderAmount = paymentAmount;
    let advanceAmount: number | undefined;
    let remainingAmount: number | undefined;

    if (isAdvance) {
      advanceAmount = Math.ceil(paymentAmount * 0.5);
      remainingAmount = paymentAmount - advanceAmount;
      orderAmount = advanceAmount;
    }

    const order = await createRazorpayOrder(orderAmount, holdId, offerId);

    // Track the attempt on the hold and extend its TTL so payment has time
    // to finish. paymentAmount must store the amount actually charged to
    // Razorpay (== orderAmount, which is the 50% advance when isAdvance).
    // createBookingFromHold / verify read this field back and copy it into
    // Payment.amount + advanceAmount. Storing the full slot price here
    // corrupts the advance split — advanceAmount ends up equal to
    // totalAmount and remainingAmount becomes zero.
    await db.slotHold.update({
      where: { id: holdId },
      data: {
        razorpayOrderId: order.id,
        paymentMethod: isAdvance ? "CASH" : "RAZORPAY",
        paymentAmount: orderAmount,
        paymentInitiatedAt: new Date(),
        expiresAt: new Date(
          Date.now() + PAYMENT_ATTEMPT_TTL_MINUTES * 60 * 1000
        ),
      },
    });

    return NextResponse.json({
      orderId: order.id,
      keyId: RAZORPAY_KEY_ID,
      amount: orderAmount,
      currency: "INR",
      holdId,
      isAdvance: !!isAdvance,
      advanceAmount: advanceAmount ?? null,
      remainingAmount: remainingAmount ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create order" },
      { status: 500 }
    );
  }
}

// Silences unused-warning for shared constants.
void LOCK_TTL_MINUTES;
