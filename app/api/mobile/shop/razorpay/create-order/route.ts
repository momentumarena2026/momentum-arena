import { NextRequest, NextResponse } from "next/server";
import { getMobileUser } from "@/lib/mobile-auth";
import { db } from "@/lib/db";
import { createRazorpayOrder, RAZORPAY_KEY_ID } from "@/lib/razorpay";
import { getOrderForRazorpay } from "@/actions/shop-order";

/**
 * POST /api/mobile/shop/razorpay/create-order
 * Body: { orderId }
 *
 * Mobile twin of the web route — JWT-auth'd. Returns the SDK keys
 * the React Native Razorpay component needs.
 */
export async function POST(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { orderId } = await request.json();
  if (!orderId) {
    return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
  }

  const orderInfo = await getOrderForRazorpay(orderId, user.id);
  if (!orderInfo) {
    return NextResponse.json(
      { error: "Order not found or already paid" },
      { status: 404 },
    );
  }

  try {
    const amountRupees = orderInfo.totalPaise / 100;
    const rzpOrder = await createRazorpayOrder(amountRupees, orderInfo.orderId);
    await db.productOrderPayment.update({
      where: { orderId: orderInfo.orderId },
      data: { razorpayOrderId: rzpOrder.id },
    });
    return NextResponse.json({
      orderId: orderInfo.orderId,
      keyId: RAZORPAY_KEY_ID,
      razorpayOrderId: rzpOrder.id,
      amount: amountRupees,
      currency: "INR",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Razorpay error" },
      { status: 500 },
    );
  }
}
