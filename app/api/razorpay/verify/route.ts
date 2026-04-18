import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { db } from "@/lib/db";
import { verifyRazorpaySignature } from "@/lib/razorpay";
import {
  sendBookingConfirmation,
  notifyAdminBookingConfirmed,
} from "@/lib/notifications";
import { createBookingFromHold } from "@/actions/booking";

export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const {
    holdId,
    razorpayPaymentId,
    razorpayOrderId,
    razorpaySignature,
    isAdvance,
  } = await request.json();

  if (!holdId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // Look up the hold; tolerate a missing hold if this is a retry (idempotency in createBookingFromHold)
  const hold = await db.slotHold.findUnique({ where: { id: holdId } });

  // Signature verification always runs — defence in depth even if hold is gone
  const isValid = verifyRazorpaySignature(
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature
  );
  if (!isValid) {
    return NextResponse.json(
      { error: "Invalid payment signature" },
      { status: 400 }
    );
  }

  // Idempotency: if this payment already resulted in a Booking, return it.
  const existing = await db.payment.findFirst({
    where: { razorpayPaymentId },
  });
  if (existing) {
    return NextResponse.json({ success: true, bookingId: existing.bookingId });
  }

  if (!hold) {
    return NextResponse.json(
      { error: "Hold expired — please try again" },
      { status: 410 }
    );
  }
  if (hold.userId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (hold.razorpayOrderId !== razorpayOrderId) {
    return NextResponse.json({ error: "Order mismatch" }, { status: 400 });
  }

  const paymentAmount = hold.paymentAmount ?? hold.totalAmount;
  const fullAmount = hold.totalAmount;
  const advanceAmount = isAdvance ? paymentAmount : undefined;
  const remainingAmount = isAdvance ? fullAmount - paymentAmount : undefined;

  const bookingId = await createBookingFromHold(
    holdId,
    {
      // Advance method reflects HOW the advance was paid, not how the
      // remainder will be collected at the venue. Status lands on PARTIAL
      // when this is an advance (flips to COMPLETED via
      // markRemainderCollected) or COMPLETED for full-pay bookings.
      method: "RAZORPAY",
      status: isAdvance ? "PARTIAL" : "COMPLETED",
      amount: paymentAmount,
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      confirmedAt: new Date(),
      isPartialPayment: !!isAdvance,
      advanceAmount,
      remainingAmount,
    },
    "CONFIRMED"
  );

  if (!bookingId) {
    return NextResponse.json(
      { error: "Failed to create booking" },
      { status: 500 }
    );
  }

  sendBookingConfirmation(bookingId).catch((err) => console.error("Notification dispatch failed:", err));
  notifyAdminBookingConfirmed(bookingId).catch((err) => console.error("Notification dispatch failed:", err));

  return NextResponse.json({ success: true, bookingId });
}
