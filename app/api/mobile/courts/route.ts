import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUserId } from "@/lib/auth-unified";
import { logBookingRequest } from "@/lib/server-log";
import { isSport } from "@/lib/court-config";

// Public court-config listing for the mobile app. No auth: court metadata
// (size, label, zones) is already visible to anyone browsing the website,
// and gating the list behind OTP sign-in just traps signed-out users on a
// dead-end "Couldn't load courts" screen.
export async function GET(request: NextRequest) {
  const userId = await getAuthUserId(request).catch(() => null);
  const sport = request.nextUrl.searchParams.get("sport");
  // Validate against the Sport enum before hitting Prisma — an unknown
  // value in a `where` clause throws a runtime validation error (500),
  // so reject it as a 400 up front. The guard also narrows `sport` to
  // the `Sport` type, dropping the previous `as any` cast.
  if (!sport || !isSport(sport)) {
    logBookingRequest(request, "booking.view_court_configs", "error", {
      userId,
      error: "Sport is required",
    });
    return NextResponse.json({ error: "Sport is required" }, { status: 400 });
  }

  const configs = await db.courtConfig.findMany({
    where: {
      sport,
      isActive: true,
    },
    orderBy: [{ size: "asc" }, { label: "asc" }],
  });

  logBookingRequest(request, "booking.view_court_configs", "success", {
    userId,
    metadata: { sport, configCount: configs.length },
  });

  return NextResponse.json(configs);
}
