import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMobileUser } from "@/lib/mobile-auth";

/**
 * GET /api/mobile/bookings
 *
 * Paginated list of the caller's bookings. The mobile client drives
 * infinite scroll off the `hasMore` flag — when it's `true`, the next
 * request bumps `page` by one. We also hydrate page 1 with a `summary`
 * block so the hero card's "Confirmed / Upcoming / Spent" tiles don't
 * grow as the user scrolls.
 */
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
export async function GET(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = request.nextUrl.searchParams.get("status");
  const page = Math.max(parseInt(request.nextUrl.searchParams.get("page") || "1"), 1);
  const limit = Math.min(
    Math.max(parseInt(request.nextUrl.searchParams.get("limit") || "20"), 1),
    50,
  );
  const skip = (page - 1) * limit;

  const where = {
    // Either the booking is theirs, or it is a challenge booking for a match
    // they are a captain of. Whoever pays first owns the row, so keying on
    // ownership alone hid a court from the captain who paid second — money in,
    // nothing in My Bookings.
    OR: [
      { userId: user.id },
      {
        challenges: {
          some: { OR: [{ createdByUserId: user.id }, { acceptedByUserId: user.id }] },
        },
      },
    ],
    ...(status
      ? {
          status: status as
            | "CONFIRMED"
            | "PENDING"
            | "CANCELLED"
            | "COMPLETED"
            | "ABSENT",
        }
      : {}),
  };

  // Fetch limit+1 to detect whether a next page exists without a
  // separate count query. We slice off the extra row before returning.
  const rows = await db.booking.findMany({
    where,
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
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    skip,
  });

  const hasMore = rows.length > limit;
  const bookings = hasMore ? rows.slice(0, limit) : rows;

  // Only page 1 needs the hero summary — the client caches it and later
  // pages append to the list without overwriting the totals.
  let summary: {
    total: number;
    upcoming: number;
    confirmed: number;
    totalSpent: number;
  } | undefined;

  if (page === 1) {
    // Use the same `where` (honouring status filter) so the numbers
    // stay consistent with the rows actually rendered.
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [total, upcoming, confirmed, spentAgg] = await Promise.all([
      db.booking.count({ where }),
      db.booking.count({
        where: {
          ...where,
          status: { in: ["CONFIRMED", "PENDING"] },
          date: { gte: todayStart },
        },
      }),
      db.booking.count({ where: { ...where, status: "CONFIRMED" } }),
      db.booking.aggregate({
        // Money spent is historical: a played (COMPLETED) or no-showed
        // (ABSENT) booking was still paid for, so closing a booking out
        // must not make the "Spent" tile drop. Only CANCELLED is excluded.
        //
        // OWNED bookings only, deliberately not the widened `where` above. A
        // challenge court is visible to both captains but paid half each, so
        // summing its total for both showed a captain who spent ₹500 a "SPENT
        // ₹2K" tile — and counted the same court twice across two people.
        where: {
          userId: user.id,
          status: { in: ["CONFIRMED", "PENDING", "COMPLETED", "ABSENT"] },
          ...(status ? { status: status as never } : {}),
        },
        _sum: { totalAmount: true },
      }),
    ]);

    summary = {
      total,
      upcoming,
      confirmed,
      totalSpent: spentAgg._sum.totalAmount ?? 0,
    };
  }

  return NextResponse.json({
    bookings: bookings.map((b) => withoutGatewayRefs(b, user.id)),
    page,
    limit,
    hasMore,
    nextPage: hasMore ? page + 1 : null,
    ...(summary ? { summary } : {}),
  });
}
