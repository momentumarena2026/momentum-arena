import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMobileUser } from "@/lib/mobile-auth";
import { db } from "@/lib/db";
import { createRazorpayOrder, RAZORPAY_KEY_ID } from "@/lib/razorpay";

/**
 * Initiate Razorpay for a CafePaymentIntent on mobile. The orderId
 * arrives as the intent id from POST /api/mobile/cafe/orders. We
 * create the Razorpay order and stamp the gateway reference on
 * the intent so the verify endpoint can find it.
 */
const Body = z.object({ orderId: z.string().min(1) });

export async function POST(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
  }
  const { orderId } = parsed.data;

  const intent = await db.cafePaymentIntent.findUnique({
    where: { id: orderId },
  });
  if (!intent) {
    return NextResponse.json(
      { error: "Checkout session expired — please start again" },
      { status: 404 },
    );
  }
  if (intent.userId && intent.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
      orderId: intent.id,
      razorpayOrderId: razorpayOrder.id,
      keyId: RAZORPAY_KEY_ID,
      amount: intent.totalAmount, // rupees — client multiplies x100 for the SDK
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
