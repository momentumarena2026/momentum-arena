import { NextRequest, NextResponse } from "next/server";
import { releaseSlotHold, getValidHold } from "@/lib/slot-hold";
import { auth } from "@/lib/auth";
import { getAuthUserId } from "@/lib/auth-unified";
import { logBookingRequest } from "@/lib/server-log";

/**
 * Release a transient SlotHold when the user leaves checkout without paying.
 * Accepts JSON POST and text/plain (for navigator.sendBeacon).
 *
 * The body may use either `holdId` (new) or `bookingId` (legacy client) — we
 * accept both so a stale browser tab doesn't crash.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      logBookingRequest(request, "booking.release_hold", "error", {
        error: "Unauthorized",
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const contentType = request.headers.get("content-type") || "";
    let body: { holdId?: string; bookingId?: string } = {};
    if (contentType.includes("application/json")) {
      body = await request.json();
    } else {
      const text = await request.text();
      try {
        body = JSON.parse(text);
      } catch {
        logBookingRequest(request, "booking.release_hold", "error", {
          userId: session.user.id,
          error: "Invalid body",
        });
        return NextResponse.json({ error: "Invalid body" }, { status: 400 });
      }
    }

    const holdId = body.holdId ?? body.bookingId;
    if (!holdId) {
      logBookingRequest(request, "booking.release_hold", "error", {
        userId: session.user.id,
        error: "Missing holdId",
      });
      return NextResponse.json({ error: "Missing holdId" }, { status: 400 });
    }

    const hold = await getValidHold(holdId, session.user.id);
    const sport = hold?.courtConfig.sport ?? null;
    const released = await releaseSlotHold(holdId, session.user.id);
    logBookingRequest(request, "booking.release_hold", "success", {
      userId: session.user.id,
      metadata: { holdId, released, sport },
    });
    return NextResponse.json({ released });
  } catch {
    const userId = await getAuthUserId(request).catch(() => null);
    logBookingRequest(request, "booking.release_hold", "error", {
      userId,
      error: "Failed",
    });
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
