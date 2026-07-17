import { NextRequest, NextResponse } from "next/server";
import { getMobileUser } from "@/lib/mobile-auth";
import { getValidHold } from "@/lib/slot-hold";
import { getPassOfferForHold } from "@/lib/passes";
import { logBookingRequest } from "@/lib/server-log";

// GET /api/mobile/booking/hold/[holdId] — returns the SlotHold contents
// (including courtConfig) for the native checkout screen. Verifies the hold
// belongs to the authenticated user and hasn't expired.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ holdId: string }> }
) {
  const user = await getMobileUser(request);
  if (!user) {
    logBookingRequest(request, "booking.view_hold", "error", {
      error: "Unauthorized",
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { holdId } = await params;
  const hold = await getValidHold(holdId, user.id);
  if (!hold) {
    logBookingRequest(request, "booking.view_hold", "error", {
      userId: user.id,
      metadata: { holdId },
      error: "Hold not found or expired",
    });
    return NextResponse.json(
      { error: "Hold not found or expired" },
      { status: 404 }
    );
  }

  logBookingRequest(request, "booking.view_hold", "success", {
    userId: user.id,
    metadata: {
      holdId,
      sport: hold.courtConfig.sport,
      date: hold.date,
      slotCount: hold.hours.length,
      totalAmount: hold.totalAmount,
    },
  });

  // Eligible pass + coverage for the "Use my pass" banner — same
  // server-side math the web checkout page runs (null when no eligible
  // pass, or when a coupon/points are already applied to the hold).
  const passOffer = await getPassOfferForHold(hold).catch(() => null);

  return NextResponse.json({
    id: hold.id,
    courtConfigId: hold.courtConfigId,
    date: hold.date,
    hours: hold.hours,
    // Bowling-machine holds carry per-slot start minutes (0 or 30)
    // parallel to `hours`. Hourly holds send an empty array.
    startMinutes: hold.startMinutes ?? [],
    slotPrices: hold.slotPrices,
    totalAmount: hold.totalAmount,
    expiresAt: hold.expiresAt,
    wasBookedAsHalfCourt: hold.wasBookedAsHalfCourt,
    couponId: hold.couponId,
    couponCode: hold.couponCode,
    discountAmount: hold.discountAmount,
    pointsToRedeem: hold.pointsToRedeem,
    pointsRedeemPaiseSaved: hold.pointsRedeemPaiseSaved,
    equipmentSelection: hold.equipmentSelection ?? null,
    equipmentTotalAmount: hold.equipmentTotalAmount ?? null,
    courtConfig: hold.courtConfig,
    passOffer,
  });
}
