import { NextRequest, NextResponse } from "next/server";
import { getMobileUser } from "@/lib/mobile-auth";
import { db } from "@/lib/db";
import { createRazorpayOrder, RAZORPAY_KEY_ID } from "@/lib/razorpay";
import { getValidHold } from "@/lib/slot-hold";
import { verifyBowlingHoldStillBookable } from "@/lib/bowling-availability";
import { AnalyticsCategory, logServerAction, resolveRequestPlatform } from "@/lib/server-log";

const PAYMENT_ATTEMPT_TTL_MINUTES = 15;

// POST /api/mobile/razorpay/create-order — mirror of the web endpoint but
// scoped to the mobile JWT. Returns the Razorpay order details the native
// SDK needs to launch the checkout sheet.
export async function POST(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    holdId?: string;
    offerId?: string;
    isAdvance?: boolean;
    overrideAmount?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { holdId, offerId, isAdvance, overrideAmount } = body;
  if (!holdId) {
    return NextResponse.json({ error: "Missing holdId" }, { status: 400 });
  }

  const hold = await getValidHold(holdId, user.id);
  if (!hold) {
    logServerAction({
      userId: user.id,
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

  // Same bowling-machine slot revalidation as the web endpoint —
  // protects against admin overrides on the shared zones between lock
  // and payment.
  const stillOk = await verifyBowlingHoldStillBookable(holdId);
  if (!stillOk.ok) {
    logServerAction({
      userId: user.id,
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
    // The charge is derived from the hold, never from the request body.
    // `overrideAmount` is still accepted (and logged) so client/server
    // drift is visible, but taking it at face value let a tampered app
    // POST {overrideAmount: 1} and get a CONFIRMED full-price booking for
    // ₹1. This mirrors the `effectiveTotal` math in createBookingFromHold
    // so the captured payment and Booking.totalAmount can never disagree.
    const appliedDiscount =
      hold.couponId && hold.discountAmount && hold.discountAmount > 0
        ? hold.discountAmount
        : 0;
    const pointsRedeemRupees =
      hold.pointsToRedeem && hold.pointsRedeemPaiseSaved
        ? Math.floor(hold.pointsRedeemPaiseSaved / 100)
        : 0;
    const paymentAmount = Math.max(
      0,
      hold.totalAmount -
        appliedDiscount -
        pointsRedeemRupees +
        (hold.equipmentTotalAmount ?? 0)
    );

    // Fully covered by coupon + points — there is nothing to charge, and
    // Razorpay would reject a zero-value order anyway. The client hides
    // the pay button in this state, so this is a tamper/drift guard.
    if (paymentAmount <= 0) {
      return NextResponse.json(
        { error: "Nothing left to pay for this booking" },
        { status: 400 }
      );
    }

    let orderAmount = paymentAmount;
    let advanceAmount: number | undefined;
    let remainingAmount: number | undefined;

    if (isAdvance) {
      advanceAmount = Math.ceil(paymentAmount * 0.5);
      remainingAmount = paymentAmount - advanceAmount;
      orderAmount = advanceAmount;
    }

    const order = await createRazorpayOrder(orderAmount, holdId, offerId);

    // Persist the attempt + extend the hold's TTL so there's time to
    // complete the native sheet, return, and verify.
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
      userId: user.id,
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
        clientAmount: overrideAmount ?? null,
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
      userId: user.id,
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
