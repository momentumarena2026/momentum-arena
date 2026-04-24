import { NextRequest, NextResponse } from "next/server";
import { getMobileUser } from "@/lib/mobile-auth";
import { db } from "@/lib/db";
import { createRazorpayOrder, RAZORPAY_KEY_ID } from "@/lib/razorpay";
import { getValidHold } from "@/lib/slot-hold";

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
    return NextResponse.json(
      { error: "Hold not found or expired" },
      { status: 404 }
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
