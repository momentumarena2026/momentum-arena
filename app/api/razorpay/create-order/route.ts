import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { db } from "@/lib/db";
import { createRazorpayOrder, RAZORPAY_KEY_ID } from "@/lib/razorpay";
import { getValidHold } from "@/lib/slot-hold";
import { LOCK_TTL_MINUTES } from "@/lib/court-config";
import { verifyBowlingHoldStillBookable } from "@/lib/bowling-availability";
import { AnalyticsCategory, logServerAction, resolveRequestPlatform } from "@/lib/server-log";

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
    logServerAction({
      userId,
      category: AnalyticsCategory.PAYMENT,
      action: "payment.razorpay.create_order",
      outcome: "error",
      path: request.nextUrl.pathname,
      method: "POST",
      platform: resolveRequestPlatform(request),
      metadata: { holdId },
      error: "Hold not found or expired",
    });
    return NextResponse.json(
      { error: "Hold not found or expired" },
      { status: 404 }
    );
  }

  // Re-check that the held slots are still bookable. For bowling
  // machine holds this catches any admin override / late turf booking
  // on the shared zones that landed between lock and payment. No-op
  // for hour-granular sports — they have their own conflict path.
  const stillOk = await verifyBowlingHoldStillBookable(holdId);
  if (!stillOk.ok) {
    logServerAction({
      userId,
      category: AnalyticsCategory.PAYMENT,
      action: "payment.razorpay.create_order",
      outcome: "error",
      path: request.nextUrl.pathname,
      method: "POST",
      platform: resolveRequestPlatform(request),
      metadata: { holdId, conflicts: stillOk.conflicts },
      error: stillOk.reason,
    });
    return NextResponse.json(
      { error: stillOk.reason, conflicts: stillOk.conflicts },
      { status: 409 },
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

    logServerAction({
      userId,
      category: AnalyticsCategory.PAYMENT,
      action: "payment.razorpay.create_order",
      outcome: "success",
      path: request.nextUrl.pathname,
      method: "POST",
      platform: resolveRequestPlatform(request),
      metadata: {
        holdId,
        orderId: order.id,
        amount: orderAmount,
        isAdvance: !!isAdvance,
        advanceAmount: advanceAmount ?? null,
        remainingAmount: remainingAmount ?? null,
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
    const message =
      error instanceof Error ? error.message : "Failed to create order";
    logServerAction({
      userId,
      category: AnalyticsCategory.PAYMENT,
      action: "payment.razorpay.create_order",
      outcome: "error",
      path: request.nextUrl.pathname,
      method: "POST",
      platform: resolveRequestPlatform(request),
      metadata: { holdId },
      error: message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Silences unused-warning for shared constants.
void LOCK_TTL_MINUTES;
