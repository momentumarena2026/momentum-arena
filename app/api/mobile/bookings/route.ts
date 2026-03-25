import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMobileUser } from "@/lib/mobile-auth";

export async function GET(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = request.nextUrl.searchParams.get("status");

  const bookings = await db.booking.findMany({
    where: {
      userId: user.id,
      ...(status ? { status: status as any } : {}),
    },
    include: {
      courtConfig: true,
      slots: { orderBy: { startHour: "asc" } },
      payment: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(bookings);
}
