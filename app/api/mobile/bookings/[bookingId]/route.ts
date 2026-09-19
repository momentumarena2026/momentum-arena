import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMobileUser } from "@/lib/mobile-auth";

/**
 * Strip gateway references the viewer has no business holding.
 *
 * A challenge court is visible to BOTH captains, which is the point — but the
 * row belongs to the POSTER while its `Payment` carries the triple of whoever
 * paid FIRST, and in the headline flow ("a stranger accepts by paying") those
 * are different people. So an owner-only guard fired exactly backwards: the
 * captain who had paid nothing got the other one's complete
 * order-id/payment-id/signature, and the captain whose money it was got the
 * redacted copy. Replaying that triple was then worth real money.
 *
 * So the rule is not "unless you own it" — it is: a booking that came from a
 * challenge carries NOBODY's gateway references, to anybody. The app has never
 * needed them, and every amount, which is what both captains actually need,
 * stays.
 */
function withoutGatewayRefs<
  T extends {
    userId: string;
    challenges?: unknown[];
    payment: Record<string, unknown> | null;
  },
>(booking: T, viewerId: string): T {
  const shared = (booking.challenges?.length ?? 0) > 0;
  if (!booking.payment || (!shared && booking.userId === viewerId)) return booking;
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
      // So the app can say "challenge match vs X" rather than showing a court
      // with no explanation of why it is in your list — and so the redaction
      // below can tell a shared court from an ordinary one.
      challenges: {
        select: {
          id: true,
          teamName: true,
          createdBy: { select: { id: true, name: true } },
          acceptedBy: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  return NextResponse.json(withoutGatewayRefs(booking, user.id));
}
