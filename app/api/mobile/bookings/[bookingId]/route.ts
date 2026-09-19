import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMobileUser } from "@/lib/mobile-auth";

/**
 * Strip the gateway references from a booking the viewer does not own.
 *
 * A challenge court is visible to BOTH captains, which is the point — but the
 * row belongs to whoever paid first, and its `Payment` carries that person's
 * Razorpay order id, payment id and signature. Handing one customer another's
 * full capture triple is no way to share a court: nothing in this module would
 * honour a replay of it, but it is somebody else's payment credential and it
 * has no business on this screen. The amounts, which are what the other
 * captain actually needs, all stay.
 */
function withoutOthersGatewayRefs<
  T extends { userId: string; payment: Record<string, unknown> | null },
>(booking: T, viewerId: string): T {
  if (!booking.payment || booking.userId === viewerId) return booking;
  const {
    razorpayOrderId: _o,
    razorpayPaymentId: _p,
    razorpaySignature: _s,
    secondRazorpayPaymentId: _s2,
    phonePeMerchantTxnId: _m,
    phonePeTransactionId: _t,
    utrNumber: _u,
    ...safe
  } = booking.payment;
  return { ...booking, payment: safe };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> }
) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { bookingId } = await params;

  const booking = await db.booking.findFirst({
    where: {
      id: bookingId,
      OR: [
        { userId: user.id },
        // A challenge booking belongs to TWO teams. The captain who did not
        // happen to pay first was locked out of a booking they had put real
        // money into — could not see it, check in against it, or be reminded
        // of it. The money is on the same court either way.
        {
          challenges: {
            some: { OR: [{ createdByUserId: user.id }, { acceptedByUserId: user.id }] },
          },
        },
      ],
    },
    include: {
      courtConfig: true,
      slots: { orderBy: { startHour: "asc" } },
      payment: true,
    },
  });

  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  return NextResponse.json(withoutOthersGatewayRefs(booking, user.id));
}
