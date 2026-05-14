import { NextRequest, NextResponse } from "next/server";
import { getMobileUser } from "@/lib/mobile-auth";
import { getBowlingMachineAvailability } from "@/lib/bowling-availability";

/**
 * GET /api/mobile/availability/bowling-machine?configId=...&date=YYYY-MM-DD
 *
 * Mobile JWT-auth'd version of the web route. Same response shape:
 *   { slots: Array<{ hour, minute, status, price }> }
 *
 * Auth is required — the bowling-machine availability surface is
 * only relevant to signed-in users completing a booking.
 */
export async function GET(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const configId = url.searchParams.get("configId");
  const date = url.searchParams.get("date");
  if (!configId || !date) {
    return NextResponse.json(
      { error: "configId and date are required" },
      { status: 400 },
    );
  }

  try {
    const slots = await getBowlingMachineAvailability(configId, new Date(date));
    return NextResponse.json({ slots });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load availability" },
      { status: 500 },
    );
  }
}
