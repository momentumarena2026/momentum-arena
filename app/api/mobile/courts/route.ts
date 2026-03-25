import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMobileUser } from "@/lib/mobile-auth";

export async function GET(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sport = request.nextUrl.searchParams.get("sport");
  if (!sport) {
    return NextResponse.json({ error: "Sport is required" }, { status: 400 });
  }

  const configs = await db.courtConfig.findMany({
    where: {
      sport: sport as any,
      isActive: true,
    },
    orderBy: [{ size: "asc" }, { label: "asc" }],
  });

  return NextResponse.json(configs);
}
