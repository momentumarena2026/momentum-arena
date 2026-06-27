import { NextRequest, NextResponse } from "next/server";
import { getMobileUser } from "@/lib/mobile-auth";
import { db } from "@/lib/db";

/**
 * POST /api/mobile/recurring/cancel  — { recurringBookingId }
 *
 * Cancels a recurring series the caller owns: marks the RecurringBooking
 * CANCELLED and cancels all of its future (today onward) PENDING/CONFIRMED
 * occurrences. Past/already-played bookings are untouched. Mirrors the web
 * `cancelRecurringBooking` server action (actions/recurring-booking.ts) but
 * authenticates via the mobile bearer JWT instead of a NextAuth session.
 */
export async function POST(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { recurringBookingId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const recurringBookingId = body.recurringBookingId;
  if (!recurringBookingId) {
    return NextResponse.json(
      { error: "recurringBookingId is required" },
      { status: 400 },
    );
  }

  const recurring = await db.recurringBooking.findUnique({
    where: { id: recurringBookingId },
  });
  if (!recurring) {
    return NextResponse.json(
      { error: "Recurring booking not found" },
      { status: 404 },
    );
  }
  if (recurring.userId !== user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  if (recurring.status === "CANCELLED") {
    return NextResponse.json({ error: "Already cancelled" }, { status: 400 });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  await db.$transaction([
    db.booking.updateMany({
      where: {
        recurringBookingId,
        date: { gte: today },
        status: { in: ["PENDING", "CONFIRMED"] },
      },
      data: { status: "CANCELLED" },
    }),
    db.recurringBooking.update({
      where: { id: recurringBookingId },
      data: { status: "CANCELLED" },
    }),
  ]);

  return NextResponse.json({ success: true });
}
