import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { logBookingRequest } from "@/lib/server-log";
import { Sport } from "@prisma/client";

/**
 * POST /api/booking/select-court
 * Body: { sport, courtConfigId?, mode?, label, size? }
 *
 * Audit log when the customer taps a court-size tile (web or mobile).
 * Does not reserve slots — only records the selection for funnel analytics.
 */
export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request).catch(() => null);

  let body: {
    sport?: string;
    courtConfigId?: string;
    mode?: "medium" | "bowling";
    label?: string;
    size?: string;
  };
  try {
    body = await request.json();
  } catch {
    logBookingRequest(request, "booking.select_court_config", "error", {
      userId,
      error: "Invalid body",
    });
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { sport, courtConfigId, mode, label, size } = body;
  if (!sport || !(sport in Sport) || !label?.trim()) {
    logBookingRequest(request, "booking.select_court_config", "error", {
      userId,
      metadata: { sport, courtConfigId, mode, label, size },
      error: "Invalid or missing sport or label",
    });
    return NextResponse.json(
      { error: "Invalid or missing sport or label" },
      { status: 400 },
    );
  }

  logBookingRequest(request, "booking.select_court_config", "success", {
    userId,
    metadata: {
      sport,
      courtConfigId: courtConfigId ?? null,
      mode: mode ?? null,
      label: label.trim(),
      size: size ?? null,
    },
  });

  return NextResponse.json({ ok: true });
}
