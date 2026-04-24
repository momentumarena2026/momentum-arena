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
    userId: user.id,
    ...(status ? { status: status as "CONFIRMED" | "PENDING" | "CANCELLED" } : {}),
  };

  // Fetch limit+1 to detect whether a next page exists without a
  // separate count query. We slice off the extra row before returning.
  const rows = await db.booking.findMany({
    where,
    include: {
      courtConfig: true,
      slots: { orderBy: { startHour: "asc" } },
      payment: true,
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
        where: { ...where, status: { in: ["CONFIRMED", "PENDING"] } },
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
    bookings,
    page,
    limit,
    hasMore,
    nextPage: hasMore ? page + 1 : null,
    ...(summary ? { summary } : {}),
  });
}
