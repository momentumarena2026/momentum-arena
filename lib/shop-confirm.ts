import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";

/**
 * Confirm a shop order that Razorpay has captured payment for.
 *
 * This lives OUTSIDE actions/shop-order.ts on purpose. That file is a
 * `"use server"` module, so every export there is a public POST endpoint
 * whose arguments come from the client — an explicit `userId` parameter
 * on such an export is an IDOR, not a convenience. Here it is safe: this
 * module is never a server-action boundary, so `userId` can only be
 * supplied by server code.
 *
 * Two callers, two ways of establishing that id:
 *   - the customer action, from the authenticated request; and
 *   - /api/razorpay/webhook, which looks the order's owner up in the DB
 *     after verifying the webhook signature. The webhook has no session
 *     at all, which is precisely why the parameter needs to exist.
 *
 * `userId` still scopes the lookup rather than being trusted blindly —
 * an order that does not belong to it simply is not found.
 */
export async function confirmShopOrderPaid(args: {
  orderId: string;
  userId: string;
  razorpayPaymentId: string;
  razorpayOrderId: string;
  razorpaySignature: string;
}): Promise<{ success: boolean; error?: string }> {
  const { orderId, userId, razorpayPaymentId, razorpayOrderId, razorpaySignature } =
    args;

  const order = await db.productOrder.findFirst({
    where: { id: orderId, userId },
    include: { payment: true },
  });
  if (!order) return { success: false, error: "Order not found" };
  if (order.status === "CONFIRMED" || order.status === "FULFILLED") {
    return { success: true };
  }
  if (order.status !== "PENDING") {
    return { success: false, error: `Order is ${order.status.toLowerCase()}` };
  }
  // A valid signature only proves Razorpay captured SOME payment — it says
  // nothing about WHICH order was paid for. Without this bind the triple from
  // a ₹49 order confirms (and re-confirms) any other PENDING order of the
  // same user. razorpayOrderId is stamped on the payment row by
  // /api/shop/razorpay/create-order; mirrors the hold check in
  // /api/razorpay/verify.
  if (
    !order.payment?.razorpayOrderId ||
    order.payment.razorpayOrderId !== razorpayOrderId
  ) {
    return { success: false, error: "Order mismatch" };
  }

  await db.$transaction(async (tx) => {
    await tx.productOrder.update({
      where: { id: orderId },
      data: { status: "CONFIRMED" },
    });
    if (order.payment) {
      await tx.productOrderPayment.update({
        where: { id: order.payment.id },
        data: {
          status: "COMPLETED",
          razorpayPaymentId,
          razorpayOrderId,
          razorpaySignature,
          confirmedAt: new Date(),
        },
      });
    }
  });

  revalidatePath(`/shop/orders/${orderId}`);
  revalidatePath("/admin/product-orders");
  return { success: true };
}
