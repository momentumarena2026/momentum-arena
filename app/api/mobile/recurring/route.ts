import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMobileUser } from "@/lib/mobile-auth";

/**
 * GET /api/mobile/recurring
 *
 * Lists the caller's active and paused recurring booking *series* —
 * the same shape the web's `app/(protected)/bookings/page.tsx` uses for
 * the "Recurring Series" card list.
 *
 * Each row carries the next 3 upcoming confirmed instances so the
 * mobile RecurringBookingsScreen can render the "Next up" chips
 * without a follow-up request.
 *
 * Response shape:
 * {
 *   recurring: Array<{
 *     id, status, dayOfWeek, startHour, endHour,
 *     courtConfig: { sport, size, label },
 *     bookings: Array<{ id, date, totalAmount }>
 *   }>
 * }
 */
export async function GET(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const recurring = await db.recurringBooking.findMany({
    where: {
      userId: user.id,
      status: { in: ["ACTIVE", "PAUSED"] },
    },
    include: {
      courtConfig: { select: { sport: true, size: true, label: true } },
      bookings: {
        where: { date: { gte: new Date() }, status: "CONFIRMED" },
        orderBy: { date: "asc" },
        take: 3,
        select: { id: true, date: true, totalAmount: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Trim down to the fields the mobile client actually consumes — keeps
  // the payload small and matches the web Recurring Series card.
  const payload = recurring.map((r) => ({
    id: r.id,
    status: r.status,
    dayOfWeek: r.dayOfWeek,
    startHour: r.startHour,
    endHour: r.endHour,
    courtConfig: r.courtConfig,
    bookings: r.bookings,
  }));

  return NextResponse.json({ recurring: payload });
}
