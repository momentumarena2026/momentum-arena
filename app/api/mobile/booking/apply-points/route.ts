import { NextRequest, NextResponse } from "next/server";
import { getMobileUser } from "@/lib/mobile-auth";
import { db } from "@/lib/db";
import { getValidHold } from "@/lib/slot-hold";
import { previewRedemption } from "@/lib/rewards/redeem";
import { getRewardConfig, pointsToPaise } from "@/lib/rewards/config";

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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { holdId?: string; points?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { holdId, points } = body;
  if (!holdId || !Number.isInteger(points) || (points ?? 0) <= 0) {
    return NextResponse.json(
      { error: "Missing holdId or invalid points" },
      { status: 400 },
    );
  }

  const hold = await getValidHold(holdId, user.id);
  if (!hold) {
    return NextResponse.json(
      { error: "Hold not found or expired" },
      { status: 404 },
    );
  }

  const cfg = await getRewardConfig();
  const couponDiscount =
    hold.couponId && hold.discountAmount && hold.discountAmount > 0
      ? hold.discountAmount
      : 0;
  const postCouponRupees = Math.max(0, hold.totalAmount - couponDiscount);
  const billPaise = postCouponRupees * 100;

  const preview = await previewRedemption({ userId: user.id, billPaise });
  if (preview.blockedReason) {
    return NextResponse.json(
      { success: false, error: preview.blockedReason },
      { status: 400 },
    );
  }
  if ((points ?? 0) > preview.maxPoints) {
    return NextResponse.json(
      {
        success: false,
        error: `Max ${preview.maxPoints} points allowed on this bill`,
      },
      { status: 400 },
    );
  }
  if ((points ?? 0) < cfg.minPointsToRedeem) {
    return NextResponse.json(
      {
        success: false,
        error: `Need at least ${cfg.minPointsToRedeem} points`,
      },
      { status: 400 },
    );
  }

  const paiseSaved = pointsToPaise(points!, cfg);
  await db.slotHold.update({
    where: { id: holdId },
    data: {
      pointsToRedeem: points,
      pointsRedeemPaiseSaved: paiseSaved,
    },
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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const holdId = new URL(request.url).searchParams.get("holdId");
  if (!holdId) {
    return NextResponse.json({ error: "Missing holdId" }, { status: 400 });
  }

  const hold = await getValidHold(holdId, user.id);
  if (!hold) return NextResponse.json({ success: false });

  await db.slotHold.update({
    where: { id: holdId },
    data: { pointsToRedeem: null, pointsRedeemPaiseSaved: null },
  });

  return NextResponse.json({ success: true });
}
