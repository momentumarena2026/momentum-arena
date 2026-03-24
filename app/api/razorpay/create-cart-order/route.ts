import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createRazorpayOrder, RAZORPAY_KEY_ID } from "@/lib/razorpay";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { bookingIds, offerId } = await request.json();

    if (!bookingIds || bookingIds.length === 0) {
      return NextResponse.json({ error: "No bookings provided" }, { status: 400 });
    }

    // Validate all bookings are LOCKED and owned by user
    const bookings = await db.booking.findMany({
      where: {
        id: { in: bookingIds },
        userId: session.user.id,
        status: "LOCKED",
      },
    });

    if (bookings.length !== bookingIds.length) {
      return NextResponse.json(
        { error: "Some bookings are no longer locked or not found" },
        { status: 400 }
      );
    }

    // Check none have expired locks
    const now = new Date();
    const expired = bookings.filter(
      (b) => b.lockExpiresAt && b.lockExpiresAt < now
    );
    if (expired.length > 0) {
      return NextResponse.json(
        { error: "Some booking locks have expired" },
        { status: 400 }
      );
    }

    // Calculate combined total
    const totalAmount = bookings.reduce((sum, b) => sum + b.totalAmount, 0);

    // Create single Razorpay order for combined amount
    const receipt = `cart-${bookingIds[0].slice(-6)}`;
    const order = await createRazorpayOrder(totalAmount, receipt, offerId);

    // Create payment records for each booking, linking to the same Razorpay order
    for (const booking of bookings) {
      await db.payment.upsert({
        where: { bookingId: booking.id },
        update: {
          razorpayOrderId: order.id,
          method: "RAZORPAY",
          status: "PENDING",
          amount: booking.totalAmount,
        },
        create: {
          bookingId: booking.id,
          method: "RAZORPAY",
          status: "PENDING",
          amount: booking.totalAmount,
          razorpayOrderId: order.id,
        },
      });
    }

    return NextResponse.json({
      orderId: order.id,
      keyId: RAZORPAY_KEY_ID,
      amount: totalAmount,
      currency: "INR",
      bookingIds,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create order" },
      { status: 500 }
    );
  }
}
