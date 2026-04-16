import { NextRequest, NextResponse } from "next/server";
import { releaseSlotHold } from "@/lib/slot-hold";
import { auth } from "@/lib/auth";

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
        return NextResponse.json({ error: "Invalid body" }, { status: 400 });
      }
    }

    const holdId = body.holdId ?? body.bookingId;
    if (!holdId) {
      return NextResponse.json({ error: "Missing holdId" }, { status: 400 });
    }

    const released = await releaseSlotHold(holdId, session.user.id);
    return NextResponse.json({ released });
  } catch {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
