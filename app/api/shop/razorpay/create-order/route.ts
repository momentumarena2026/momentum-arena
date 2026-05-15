import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { db } from "@/lib/db";
import { createRazorpayOrder, RAZORPAY_KEY_ID } from "@/lib/razorpay";
import { getOrderForRazorpay } from "@/actions/shop-order";

/**
 * POST /api/shop/razorpay/create-order
 *
 * Body: { orderId }
 *
 * Looks up the customer's PENDING ProductOrder, creates a Razorpay
 * order for its totalPaise (rounded from `totalPaise/100` so the
 * SDK gets rupees), stores the razorpayOrderId on the
 * ProductOrderPayment row, and returns the SDK keys + amount so
 * the client can pop the Razorpay modal.
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

  const orderInfo = await getOrderForRazorpay(orderId);
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
      // Customer SDK expects rupees here; the SDK internally
      // multiplies by 100 (matches our existing booking flow).
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
