import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMobileAdmin } from "@/lib/mobile-auth";

/**
 * GET /api/mobile/admin/bookings
 *
 * Mirrors `getAdminBookings` from actions/admin-booking.ts but reads
 * the bearer-token admin context instead of the NextAuth web session.
 * Returns the same enriched shape (with recurring-child payment
 * inheritance) so the mobile list screen can render the same chips
 * and pills as the web admin table.
 *
 * Query params: status, sport, date, platform, page, limit.
 *   - status defaults to CONFIRMED (mirrors the web default).
 *   - status="ALL" → no status filter.
 *   - date is "YYYY-MM-DD".
 */
export async function GET(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") ?? "CONFIRMED";
  const sport = searchParams.get("sport") || undefined;
  const date = searchParams.get("date") || undefined;
  const platform = searchParams.get("platform") || undefined;
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("limit") || "20", 10)),
  );

  const where: Record<string, unknown> = {};
  if (status && status !== "ALL") where.status = status;
  if (sport) where.courtConfig = { sport };
  if (platform) where.platform = platform;
  if (date) where.date = new Date(date);

  const [bookings, total] = await Promise.all([
    db.booking.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, phone: true } },
        courtConfig: { select: { sport: true, label: true, size: true } },
        slots: { orderBy: { startHour: "asc" } },
        payment: true,
        recurringBooking: {
          include: {
            bookings: {
              where: { payment: { isNot: null } },
              include: { payment: true },
              take: 1,
              orderBy: { date: "asc" },
            },
          },
        },
      },
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.booking.count({ where }),
  ]);

  // Recurring-child payment inheritance — same logic as web's
  // `getAdminBookings` enrichment. Children booked as part of a series
  // don't have their own Payment row (the bundled payment lives on
  // booking #1); surface that payment on every child so the mobile
  // list shows accurate "PAID / PARTIAL / PENDING" pills.
  const enriched = bookings.map((b) => {
    if (!b.payment && b.recurringBooking?.bookings?.[0]?.payment) {
      return {
        ...b,
        payment: b.recurringBooking.bookings[0].payment,
        _isRecurringChildPayment: true,
      };
    }
    return { ...b, _isRecurringChildPayment: false };
  });

  return NextResponse.json({
    bookings: enriched,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
}
