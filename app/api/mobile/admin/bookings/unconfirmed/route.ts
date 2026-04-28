import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMobileAdmin } from "@/lib/mobile-auth";

/**
 * GET /api/mobile/admin/bookings/unconfirmed
 *
 * Mirrors the composite filter the web /admin/bookings/unconfirmed
 * page uses — bookings literally awaiting admin verification of a
 * UPI screenshot or cash collection. NOT the same as the broader
 * "Pending" status chip on the regular bookings list.
 *
 * Web filter exactly:
 *   { status: "PENDING",
 *     payment: { status: "PENDING", method: { in: ["UPI_QR","CASH"] } } }
 *
 * Auto-confirmed gateway payments (Razorpay / PhonePe) are excluded
 * because the gateway webhook flips them to CONFIRMED already; if
 * they're sitting at PENDING something is wrong upstream and they
 * shouldn't clutter the floor-staff queue.
 */
export async function GET(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("limit") || "20", 10)),
  );

  const where = {
    status: "PENDING" as const,
    payment: {
      status: "PENDING" as const,
      method: { in: ["UPI_QR" as const, "CASH" as const] },
    },
  };

  const [bookings, total] = await Promise.all([
    db.booking.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, phone: true } },
        courtConfig: { select: { sport: true, label: true, size: true } },
        slots: { orderBy: { startHour: "asc" } },
        payment: true,
      },
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.booking.count({ where }),
  ]);

  // Same enriched shape the regular list returns so the row component
  // can be reused without a separate type. Recurring inheritance
  // doesn't apply here — recurring child bookings don't sit in
  // PENDING with a UPI/Cash payment row of their own.
  const enriched = bookings.map((b) => ({
    ...b,
    _isRecurringChildPayment: false,
  }));

  return NextResponse.json({
    bookings: enriched,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
}
