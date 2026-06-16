import { NextRequest, NextResponse } from "next/server";
import {
  getDisplayShiftedAvailability,
  getDisplayShiftedMediumAvailability,
} from "@/lib/availability";
import { getAuthUserId } from "@/lib/auth-unified";
import { sportForCourtConfigId } from "@/lib/booking-log-sport";
import { logBookingRequest } from "@/lib/server-log";
import { Sport } from "@prisma/client";

// Simple in-memory rate limiter for availability endpoint
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 30; // 30 requests per minute per IP

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) return true;
  return false;
}

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, 5 * 60 * 1000);

export async function GET(request: NextRequest) {
  const userId = await getAuthUserId(request).catch(() => null);
  const { searchParams } = new URL(request.url);
  const configId = searchParams.get("configId");
  const date = searchParams.get("date");
  const mode = searchParams.get("mode");
  const sport = searchParams.get("sport");

  const logAvail = (
    outcome: "success" | "error",
    metadata: Record<string, unknown>,
    error?: string,
  ) =>
    logBookingRequest(request, "booking.view_availability", outcome, {
      userId,
      metadata,
      error,
    });

  // Rate limit by IP
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (isRateLimited(ip)) {
    logAvail("error", { date, configId, mode, sport, rateLimited: true }, "Too many requests");
    return NextResponse.json(
      { error: "Too many requests. Please try again in a minute." },
      { status: 429 }
    );
  }

  if (!date) {
    logAvail("error", { configId, mode, sport }, "date is required");
    return NextResponse.json(
      { error: "date is required" },
      { status: 400 }
    );
  }

  // Medium (half-court) merged availability: customer sees a single
  // "Half Court (40×90)" view across LEFT + RIGHT. An hour is available
  // if at least one half is free.
  if (mode === "medium") {
    if (!sport) {
      logAvail("error", { date, mode }, "sport is required when mode=medium");
      return NextResponse.json(
        { error: "sport is required when mode=medium" },
        { status: 400 }
      );
    }
    try {
      const slots = await getDisplayShiftedMediumAvailability(
        sport as Sport,
        new Date(date)
      );
      logAvail("success", {
        date,
        mode,
        sport,
        slotCount: slots.length,
        availableCount: slots.filter((s) => s.status === "available").length,
      });
      return NextResponse.json(
        { slots },
        { headers: { "Cache-Control": "public, max-age=30, s-maxage=30" } }
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to get availability";
      logAvail("error", { date, mode, sport }, message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  if (!configId) {
    logAvail("error", { date }, "configId and date are required");
    return NextResponse.json(
      { error: "configId and date are required" },
      { status: 400 }
    );
  }

  try {
    const slots = await getDisplayShiftedAvailability(configId, new Date(date));
    const resolvedSport = sport ?? (await sportForCourtConfigId(configId));
    logAvail("success", {
      date,
      configId,
      sport: resolvedSport,
      slotCount: slots.length,
      availableCount: slots.filter((s) => s.status === "available").length,
    });
    return NextResponse.json({ slots }, {
      headers: {
        "Cache-Control": "public, max-age=30, s-maxage=30",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to get availability";
    const resolvedSport = sport ?? (await sportForCourtConfigId(configId));
    logAvail("error", { date, configId, sport: resolvedSport }, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
