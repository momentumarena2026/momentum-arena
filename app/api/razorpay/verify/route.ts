import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { db } from "@/lib/db";
import { verifyRazorpaySignature } from "@/lib/razorpay";
import { sendBookingConfirmation } from "@/lib/notifications";

export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { bookingId, razorpayPaymentId, razorpayOrderId, razorpaySignature, isAdvance } =
    await request.json();

  const payment = await db.payment.findUnique({
    where: { bookingId },
    include: { booking: true },
  });

  if (!payment || payment.booking.userId !== userId) {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }

  // Verify signature
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

  await db.$transaction([
    db.payment.update({
      where: { id: payment.id },
      data: {
        status: "COMPLETED",
        razorpayPaymentId,
        razorpaySignature,
        confirmedAt: new Date(),
      },
    }),
    db.booking.update({
      where: { id: bookingId },
      data: { status: "CONFIRMED" },
    }),
  ]);

  await sendBookingConfirmation(bookingId);

  return NextResponse.json({ success: true });
}
