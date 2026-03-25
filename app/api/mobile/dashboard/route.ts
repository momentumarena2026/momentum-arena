import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMobileUser } from "@/lib/mobile-auth";

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
        userId: user.id,
        status: "CONFIRMED",
        date: { gte: today },
      },
      include: {
        courtConfig: true,
        slots: { orderBy: { startHour: "asc" } },
        payment: true,
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
    upcomingBookings,
  });
}
