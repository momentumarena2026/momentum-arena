import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { sportForCourtConfigId } from "@/lib/booking-log-sport";
import { getBowlingMachineAvailability } from "@/lib/bowling-availability";
import { logBookingRequest } from "@/lib/server-log";

/**
 * GET /api/availability/bowling-machine?configId=...&date=YYYY-MM-DD
 *
 * Half-hour availability for the bowling-machine court. Mirrors the
 * shape of /api/availability but each entry has a `minute` field
 * (0 or 30) alongside the hour, and `status` includes "closed" for
 * past-time / outside-operating-windows blanks so the picker UI
 * can decide whether to grey-out vs hide the cell.
 *
 * Keeps the existing /api/availability endpoint untouched so the
 * cricket / football paths don't have to learn about half-hour
 * status values mid-stream.
 */
export async function GET(request: NextRequest) {
  const userId = await getAuthUserId(request).catch(() => null);
  const url = new URL(request.url);
  const configId = url.searchParams.get("configId");
  const date = url.searchParams.get("date");

  const logAvail = (
    outcome: "success" | "error",
    metadata: Record<string, unknown>,
    error?: string,
  ) =>
    logBookingRequest(request, "booking.view_bowling_availability", outcome, {
      userId,
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
