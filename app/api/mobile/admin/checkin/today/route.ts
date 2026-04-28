import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { getTodayIST } from "@/lib/ist-date";

/**
 * GET /api/mobile/admin/checkin/today
 *
 * Returns today's CONFIRMED bookings for the mobile check-in surface.
 * The web check-in flow is QR-only (camera scan), but on mobile a
 * staffer often wants to look up a booking by name when the customer
 * doesn't have their QR handy. This endpoint backs that list.
 *
 * Same date semantics as the rest of the admin surface — IST today,
 * normalised to midnight UTC the way bookings are stored.
 */
export async function GET(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = getTodayIST();
  const dateOnly = new Date(today + "T00:00:00Z");

  const bookings = await db.booking.findMany({
    where: {
      date: dateOnly,
      status: "CONFIRMED",
    },
    include: {
      user: { select: { id: true, name: true, phone: true } },
      courtConfig: { select: { sport: true, label: true, size: true } },
      slots: { orderBy: { startHour: "asc" } },
      payment: { select: { status: true, method: true } },
    },
    // Floor-staff want the next slot at the top, then later slots
    // descending by start time. Plus a stable secondary sort so the
    // list doesn't shuffle on refetch when two bookings share a start
    // hour.
    orderBy: [{ createdAt: "asc" }],
  });

  // Sort client-side by earliest startHour ascending so the next
  // arriving customer is at the top.
  const enriched = bookings
    .map((b) => ({
      id: b.id,
      qrToken: b.qrToken,
      checkedInAt: b.checkedInAt?.toISOString() ?? null,
      user: b.user,
      courtConfig: b.courtConfig,
      slots: b.slots.map((s) => s.startHour),
      totalAmount: b.totalAmount,
      paymentStatus: b.payment?.status ?? null,
      paymentMethod: b.payment?.method ?? null,
    }))
    .sort((a, b) => (a.slots[0] ?? 99) - (b.slots[0] ?? 99));

  return NextResponse.json({ date: today, bookings: enriched });
}
