import { NextRequest, NextResponse } from "next/server";
import { getMobileUser } from "@/lib/mobile-auth";
import { getValidHold } from "@/lib/slot-hold";

// GET /api/mobile/booking/hold/[holdId] — returns the SlotHold contents
// (including courtConfig) for the native checkout screen. Verifies the hold
// belongs to the authenticated user and hasn't expired.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ holdId: string }> }
) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { holdId } = await params;
  const hold = await getValidHold(holdId, user.id);
  if (!hold) {
    return NextResponse.json(
      { error: "Hold not found or expired" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    id: hold.id,
    courtConfigId: hold.courtConfigId,
    date: hold.date,
    hours: hold.hours,
    slotPrices: hold.slotPrices,
    totalAmount: hold.totalAmount,
    expiresAt: hold.expiresAt,
    wasBookedAsHalfCourt: hold.wasBookedAsHalfCourt,
    couponId: hold.couponId,
    couponCode: hold.couponCode,
    discountAmount: hold.discountAmount,
    courtConfig: hold.courtConfig,
  });
}
