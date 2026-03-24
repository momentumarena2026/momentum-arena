import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { verifyRazorpaySignature } from "@/lib/razorpay";
import { sendBookingConfirmation } from "@/lib/notifications";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const {
      bookingIds,
      razorpayPaymentId,
      razorpayOrderId,
      razorpaySignature,
    } = await request.json();

    if (!bookingIds || !razorpayPaymentId || !razorpayOrderId || !razorpaySignature) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
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

    // Confirm all bookings and update payments in a transaction
    await db.$transaction(
      bookingIds.flatMap((bookingId: string) => [
        db.payment.updateMany({
          where: { bookingId, razorpayOrderId },
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
      ])
    );

    // Send confirmation emails for each booking (non-blocking)
    Promise.allSettled(
      bookingIds.map((bookingId: string) =>
        sendBookingConfirmation(bookingId)
      )
    );

    return NextResponse.json({
      success: true,
      bookingIds,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Verification failed" },
      { status: 500 }
    );
  }
}
