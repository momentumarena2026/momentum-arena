import { NextRequest, NextResponse } from "next/server";
import { getMobileUser } from "@/lib/mobile-auth";
import { sportForCourtConfigId } from "@/lib/booking-log-sport";
import { getBowlingMachineAvailability } from "@/lib/bowling-availability";
import { logBookingRequest } from "@/lib/server-log";

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
    logBookingRequest(request, "booking.view_bowling_availability", "error", {
      error: "Unauthorized",
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const configId = url.searchParams.get("configId");
  const date = url.searchParams.get("date");

  const logAvail = (
    outcome: "success" | "error",
    metadata: Record<string, unknown>,
    error?: string,
  ) =>
    logBookingRequest(request, "booking.view_bowling_availability", outcome, {
      userId: user.id,
      metadata,
      error,
    });

  if (!configId || !date) {
    logAvail("error", { configId, date }, "configId and date are required");
    return NextResponse.json(
      { error: "configId and date are required" },
      { status: 400 },
    );
  }

  try {
    const slots = await getBowlingMachineAvailability(configId, new Date(date));
    const resolvedSport = await sportForCourtConfigId(configId);
    logAvail("success", {
      configId,
      date,
      sport: resolvedSport,
      slotCount: slots.length,
      availableCount: slots.filter((s) => s.status === "available").length,
    });
    return NextResponse.json({ slots });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load availability";
    const resolvedSport = await sportForCourtConfigId(configId);
    logAvail("error", { configId, date, sport: resolvedSport }, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
