import { NextRequest, NextResponse } from "next/server";
import { releaseSlotLock } from "@/lib/slot-lock";
import { auth } from "@/lib/auth";

/**
 * Release a LOCKED booking when user leaves checkout.
 * Supports both JSON POST (normal) and sendBeacon (text/plain).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let bookingId: string;

    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = await request.json();
      bookingId = body.bookingId;
    } else {
      // sendBeacon sends text/plain
      const text = await request.text();
      try {
        const parsed = JSON.parse(text);
        bookingId = parsed.bookingId;
      } catch {
        return NextResponse.json({ error: "Invalid body" }, { status: 400 });
      }
    }

    if (!bookingId) {
      return NextResponse.json({ error: "Missing bookingId" }, { status: 400 });
    }

    const released = await releaseSlotLock(bookingId, session.user.id);
    return NextResponse.json({ released });
  } catch {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
