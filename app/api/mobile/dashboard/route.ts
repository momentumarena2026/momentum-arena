import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMobileUser } from "@/lib/mobile-auth";

/**
 * Strip gateway references from a court the viewer shares rather than owns.
 *
 * A copy of the rule in the bookings routes, and for the same reason: a
 * challenge court belongs to the poster while its payment carries the first
 * payer's Razorpay triple, so an owner-only test hands one captain the other's
 * capture credentials. This endpoint had no redaction of any kind.
 */
function withoutGatewayRefs<
  T extends { userId: string; challenges?: unknown[]; payment: Record<string, unknown> | null },
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

export async function GET(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [upcomingBookings, totalBookings] = await Promise.all([
    db.booking.findMany({
      where: {
        // Either theirs, or a challenge court they are a captain of. Keying on
        // ownership alone meant the captain whose money bought the hour saw
        // "0 upcoming" on their own home screen, because the challenge booking
        // belongs to the poster.
        OR: [
          { userId: user.id },
          {
            challenges: {
              some: { OR: [{ createdByUserId: user.id }, { acceptedByUserId: user.id }] },
            },
          },
        ],
        status: "CONFIRMED",
        date: { gte: today },
      },
      include: {
        courtConfig: true,
        slots: { orderBy: { startHour: "asc" } },
        payment: true,
        challenges: {
          select: {
            id: true,
            teamName: true,
            createdBy: { select: { id: true, name: true } },
            acceptedBy: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ date: "asc" }],
      take: 5,
    }),
    db.booking.count({
      where: { userId: user.id },
    }),
  ]);

  return NextResponse.json({
    upcomingCount: upcomingBookings.length,
    totalBookings,
    upcomingBookings: upcomingBookings.map((b) => withoutGatewayRefs(b, user.id)),
  });
}
