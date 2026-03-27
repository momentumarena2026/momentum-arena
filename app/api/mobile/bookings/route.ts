import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMobileUser } from "@/lib/mobile-auth";

export async function GET(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = request.nextUrl.searchParams.get("status");
  const page = parseInt(request.nextUrl.searchParams.get("page") || "1");
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get("limit") || "20"), 50);
  const skip = (page - 1) * limit;

  const bookings = await db.booking.findMany({
    where: {
      userId: user.id,
      ...(status ? { status: status as "CONFIRMED" | "LOCKED" | "CANCELLED" } : {}),
    },
    include: {
      courtConfig: true,
      slots: { orderBy: { startHour: "asc" } },
      payment: true,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip,
  });

  return NextResponse.json({ bookings, page, limit });
}
