import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { db } from "@/lib/db";
import { createRazorpayOrder, RAZORPAY_KEY_ID } from "@/lib/razorpay";

/**
 * Initiate Razorpay for a CafePaymentIntent. The intent id arrives
 * as `orderId` in the request body for client backwards-compat —
 * it's actually the intent id from createCafeOrder's online-path
 * response. We look it up, create the Razorpay order, stamp the
 * razorpayOrderId on the intent so verify can find it.
 *
 * No CafeOrder exists yet at this point — that only happens once
 * the verify endpoint materialises a paid intent.
 */
export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { orderId } = await request.json();
  if (!orderId) {
    return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
  }

  const intent = await db.cafePaymentIntent.findUnique({
    where: { id: orderId },
  });
  if (!intent) {
    return NextResponse.json(
      { error: "Checkout session expired — please start again" },
      { status: 404 },
    );
  }
  if (intent.userId && intent.userId !== userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  if (intent.consumedAt) {
    return NextResponse.json(
      { error: "This checkout was already completed" },
      { status: 409 },
    );
  }

  try {
    const razorpayOrder = await createRazorpayOrder(
      intent.totalAmount,
      intent.id,
    );

    await db.cafePaymentIntent.update({
      where: { id: intent.id },
      data: { razorpayOrderId: razorpayOrder.id },
    });

    return NextResponse.json({
      orderId: razorpayOrder.id,
      keyId: RAZORPAY_KEY_ID,
      amount: intent.totalAmount,
      currency: "INR",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to create Razorpay order",
      },
      { status: 500 },
    );
  }
}
