import { NextRequest, NextResponse } from "next/server";
import { getBowlingMachineAvailability } from "@/lib/bowling-availability";

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
