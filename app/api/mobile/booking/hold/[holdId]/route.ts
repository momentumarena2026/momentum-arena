import { NextRequest, NextResponse } from "next/server";
import { getMobileUser } from "@/lib/mobile-auth";
import { getValidHold } from "@/lib/slot-hold";
import {
  ensureDefaultBookVia,
  getPassOfferForHold,
  parsePassModeCoverage,
} from "@/lib/passes";
import { holdCourtBase } from "@/lib/booking-amounts";
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
  let hold = await getValidHold(holdId, user.id);
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

  // First load of a fresh hold: pre-select the Pass tab when an
  // eligible pass exists (sticky — an explicit switch to Online writes
  // an opt-out marker this respects).
  const seeded = await ensureDefaultBookVia(hold).catch(() => null);
  if (seeded) {
    hold = {
      ...hold,
      passModeId: seeded.passId,
      passModeCoverage: seeded as unknown as typeof hold.passModeCoverage,
      couponId: null,
      couponCode: null,
      discountAmount: null,
      pointsToRedeem: null,
      pointsRedeemPaiseSaved: null,
    };
  }

  // Eligible pass + coverage for the "Use my pass" banner — same
  // server-side math the web checkout page runs (null when no eligible
  // pass, or when a coupon/points are already applied to the hold).
  const passOffer = await getPassOfferForHold(hold).catch(() => null);

  // Tab visibility for the "Book via" switch — ignores applied
  // coupon/points because entering the Pass tab clears them anyway.
  // (Legacy passOffer semantics stay as-is for older app builds.)
  const passModeCov = hold.passModeId
    ? parsePassModeCoverage(hold.passModeCoverage)
    : null;
  const freshOffer = passModeCov
    ? null
    : await getPassOfferForHold({
        ...hold,
        couponId: null,
        pointsToRedeem: null,
      }).catch(() => null);
  const passAvailable = !!passModeCov || !!freshOffer;

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
    // "Book via" state — non-null while the hold is in pass mode. The
    // checkout prices everything against `courtBase` (totalAmount minus
    // the snapshotted coverage; equals totalAmount outside pass mode).
    passAvailable,
    passMode: passModeCov,
    // What the Pass tab would say before it's entered ("Pass" vs
    // "Pass + Pay") — computed coupon-blind like passAvailable.
    passTabFullCoverage:
      passModeCov?.fullCoverage ?? freshOffer?.fullCoverage ?? false,
    courtBase: holdCourtBase(hold),
  });
}
