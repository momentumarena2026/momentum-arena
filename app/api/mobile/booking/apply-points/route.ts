import { NextRequest, NextResponse } from "next/server";
import { getMobileUser } from "@/lib/mobile-auth";
import { holdCourtBase } from "@/lib/booking-amounts";
import { db } from "@/lib/db";
import { getValidHold } from "@/lib/slot-hold";
import { previewRedemption } from "@/lib/rewards/redeem";
import { getRewardConfig, pointsToPaise } from "@/lib/rewards/config";
import { logBookingRequest } from "@/lib/server-log";

/**
 * Mobile counterpart of applyPointsRedemptionToHold /
 * clearPointsRedemptionFromHold (actions/booking.ts). Validates the
 * pick via previewRedemption and persists it on the SlotHold so the
 * booking-creation transaction picks it up.
 *
 * POST { holdId, points } — apply
 * DELETE ?holdId=… — clear
 */

export async function POST(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    logBookingRequest(request, "booking.apply_points", "error", {
      error: "Unauthorized",
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { holdId?: string; points?: number };
  try {
    body = await request.json();
  } catch {
    logBookingRequest(request, "booking.apply_points", "error", {
      userId: user.id,
      error: "Invalid body",
    });
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { holdId, points } = body;
  if (!holdId || !Number.isInteger(points) || (points ?? 0) <= 0) {
    logBookingRequest(request, "booking.apply_points", "error", {
      userId: user.id,
      metadata: { holdId, points },
      error: "Missing holdId or invalid points",
    });
    return NextResponse.json(
      { error: "Missing holdId or invalid points" },
      { status: 400 },
    );
  }

  const hold = await getValidHold(holdId, user.id);
  if (!hold) {
    logBookingRequest(request, "booking.apply_points", "error", {
      userId: user.id,
      metadata: { holdId, points },
      error: "Hold not found or expired",
    });
    return NextResponse.json(
      { error: "Hold not found or expired" },
      { status: 404 },
    );
  }
  const sport = hold.courtConfig.sport;

  const cfg = await getRewardConfig();
  const couponDiscount =
    hold.couponId && hold.discountAmount && hold.discountAmount > 0
      ? hold.discountAmount
      : 0;
  const postCouponRupees = Math.max(0, holdCourtBase(hold) - couponDiscount);
  const billPaise = postCouponRupees * 100;

  const preview = await previewRedemption({ userId: user.id, billPaise });
  if (preview.blockedReason) {
    logBookingRequest(request, "booking.apply_points", "error", {
      userId: user.id,
      metadata: { holdId, points, sport },
      error: preview.blockedReason,
    });
    return NextResponse.json(
      { success: false, error: preview.blockedReason },
      { status: 400 },
    );
  }
  if ((points ?? 0) > preview.maxPoints) {
    const error = `Max ${preview.maxPoints} points allowed on this bill`;
    logBookingRequest(request, "booking.apply_points", "error", {
      userId: user.id,
      metadata: { holdId, points, maxPoints: preview.maxPoints, sport },
      error,
    });
    return NextResponse.json({ success: false, error }, { status: 400 });
  }
  if ((points ?? 0) < cfg.minPointsToRedeem) {
    const error = `Need at least ${cfg.minPointsToRedeem} points`;
    logBookingRequest(request, "booking.apply_points", "error", {
      userId: user.id,
      metadata: { holdId, points, minPoints: cfg.minPointsToRedeem, sport },
      error,
    });
    return NextResponse.json({ success: false, error }, { status: 400 });
  }

  const paiseSaved = pointsToPaise(points!, cfg);
  await db.slotHold.update({
    where: { id: holdId },
    data: {
      pointsToRedeem: points,
      pointsRedeemPaiseSaved: paiseSaved,
    },
  });

  logBookingRequest(request, "booking.apply_points", "success", {
    userId: user.id,
    metadata: { holdId, points, paiseSaved, sport },
  });

  return NextResponse.json({
    success: true,
    pointsToRedeem: points,
    paiseSaved,
  });
}

export async function DELETE(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    logBookingRequest(request, "booking.clear_points", "error", {
      error: "Unauthorized",
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const holdId = new URL(request.url).searchParams.get("holdId");
  if (!holdId) {
    logBookingRequest(request, "booking.clear_points", "error", {
      userId: user.id,
      error: "Missing holdId",
    });
    return NextResponse.json({ error: "Missing holdId" }, { status: 400 });
  }

  const hold = await getValidHold(holdId, user.id);
  if (!hold) {
    logBookingRequest(request, "booking.clear_points", "error", {
      userId: user.id,
      metadata: { holdId },
      error: "Hold not found or expired",
    });
    return NextResponse.json({ success: false });
  }

  await db.slotHold.update({
    where: { id: holdId },
    data: { pointsToRedeem: null, pointsRedeemPaiseSaved: null },
  });

  logBookingRequest(request, "booking.clear_points", "success", {
    userId: user.id,
    metadata: {
      holdId,
      previousPoints: hold.pointsToRedeem,
      sport: hold.courtConfig.sport,
    },
  });

  return NextResponse.json({ success: true });
}
