import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMobileUser } from "@/lib/mobile-auth";

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
      userId: user.id,
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

  return NextResponse.json(booking);
}
