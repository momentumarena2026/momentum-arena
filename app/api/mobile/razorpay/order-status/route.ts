import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMobileUser } from "@/lib/mobile-auth";

/**
 * Has this Razorpay order already been converted into a Booking?
 *
 * The payment.captured WEBHOOK completes bookings server-side
 * independently of the app's checkout — and the native Razorpay sheet
 * has been seen hanging on its (test-mode) bank page while exactly
 * that happened, leaving the customer stuck with a paid-but-unshown
 * booking (2026-07-14). The mobile checkout calls this on every sheet
 * exit so a webhook-settled payment reads as the success it is.
 *
 * Scoped to the requesting user: an order id only resolves when the
 * booking it created belongs to the bearer, so this can't be used to
 * probe other customers' payments.
 *
 * GET /api/mobile/razorpay/order-status?orderId=order_xxx
 * → { completed: boolean, bookingId?: string }
 */
export async function GET(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orderId = request.nextUrl.searchParams.get("orderId");
  if (!orderId) {
    return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
  }

  const payment = await db.payment.findFirst({
    where: { razorpayOrderId: orderId },
    select: {
      bookingId: true,
      booking: { select: { userId: true } },
    },
  });

  if (!payment?.bookingId || payment.booking?.userId !== user.id) {
    return NextResponse.json({ completed: false });
  }

  return NextResponse.json({ completed: true, bookingId: payment.bookingId });
}
