import { NextRequest, NextResponse } from "next/server";
import { getSlotAvailability, getMergedMediumAvailability } from "@/lib/availability";
import { db } from "@/lib/db";
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
  // Rate limit by IP
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many requests. Please try again in a minute." },
      { status: 429 }
    );
  }

  const { searchParams } = new URL(request.url);
  const configId = searchParams.get("configId");
  const date = searchParams.get("date");
  const mode = searchParams.get("mode"); // "medium" for unified half-court flow
  const sport = searchParams.get("sport");

  if (!date) {
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
      return NextResponse.json(
        { error: "sport is required when mode=medium" },
        { status: 400 }
      );
    }
    try {
      const slots = await getMergedMediumAvailability(
        sport as Sport,
        new Date(date)
      );
      return NextResponse.json(
        { slots },
        { headers: { "Cache-Control": "public, max-age=30, s-maxage=30" } }
      );
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to get availability",
        },
        { status: 500 }
      );
    }
  }

  if (!configId) {
    return NextResponse.json(
      { error: "configId and date are required" },
      { status: 400 }
    );
  }

  try {
    const slots = await getSlotAvailability(configId, new Date(date));
    return NextResponse.json({ slots }, {
      headers: {
        "Cache-Control": "public, max-age=30, s-maxage=30",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get availability" },
      { status: 500 }
    );
  }
}
