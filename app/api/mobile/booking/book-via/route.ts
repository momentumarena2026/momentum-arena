import { NextRequest, NextResponse } from "next/server";
import { getMobileUser } from "@/lib/mobile-auth";
import { getValidHold } from "@/lib/slot-hold";
import { setHoldPassMode } from "@/lib/passes";

// POST /api/mobile/booking/book-via { holdId, via: "pass" | "online" } —
// the "Book via" tab switch. Entering pass mode snapshots the coverage
// (remainder becomes the checkout base); both directions clear any
// applied coupon/points since their discounts were priced on the other
// base. Returns the coverage for immediate summary recalculation.
export async function POST(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    holdId?: string;
    via?: string;
  } | null;
  if (!body?.holdId || (body.via !== "pass" && body.via !== "online")) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const hold = await getValidHold(body.holdId, user.id);
  if (!hold) {
    return NextResponse.json(
      { error: "Hold not found or expired" },
      { status: 404 },
    );
  }
  const result = await setHoldPassMode(hold, body.via === "pass");
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error });
  }
  return NextResponse.json({ ok: true, coverage: result.coverage });
}
