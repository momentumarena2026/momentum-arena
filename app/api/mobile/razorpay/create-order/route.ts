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
    const paymentAmount =
      overrideAmount && overrideAmount > 0 ? overrideAmount : hold.totalAmount;

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
