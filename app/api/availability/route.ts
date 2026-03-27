import { NextRequest, NextResponse } from "next/server";
import { getSlotAvailability } from "@/lib/availability";
import { db } from "@/lib/db";

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

  if (!configId || !date) {
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
