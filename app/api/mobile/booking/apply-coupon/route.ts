import { NextRequest, NextResponse } from "next/server";
import { getMobileUser } from "@/lib/mobile-auth";
import { db } from "@/lib/db";
import { getValidHold } from "@/lib/slot-hold";
import { validateCoupon } from "@/actions/coupon-validation";
import { AnalyticsCategory, logServerAction, resolveRequestPlatform } from "@/lib/server-log";

// POST /api/mobile/booking/apply-coupon — HTTP wrapper for applyCouponToHold
// (which is a server action tied to NextAuth and therefore unreachable from
// the native app). Validates the coupon against the hold's total and persists
// it onto the hold so downstream create-order / verify see the discount.
export async function POST(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { holdId?: string; code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { holdId, code } = body;
  if (!holdId || !code) {
    return NextResponse.json({ error: "Missing holdId or code" }, { status: 400 });
  }

  const hold = await getValidHold(holdId, user.id);
  if (!hold) {
    logServerAction({
      userId: user.id,
      action: "booking.apply_coupon",
      category: AnalyticsCategory.BOOKING,
      outcome: "error",
      path: request.nextUrl.pathname,
      method: "POST",
      platform: resolveRequestPlatform(request),
      metadata: { holdId, code },
      error: "Hold not found or expired",
    });
    return NextResponse.json(
      { error: "Hold not found or expired" },
      { status: 404 }
    );
  }

  const result = await validateCoupon(code, {
    scope: "SPORTS",
    amount: hold.totalAmount,
    userId: user.id,
    sport: hold.courtConfig.sport,
    // Lets the validator honour DiscountCode.categoryExclude — e.g. the
    // new-user coupon is configured to exclude BOWLING_MACHINE.
    bookingCategory: hold.courtConfig.category ?? null,
  });

  if (!result.valid || !result.couponId || !result.discountAmount) {
    logServerAction({
      userId: user.id,
      action: "booking.apply_coupon",
      category: AnalyticsCategory.BOOKING,
      outcome: "error",
      path: request.nextUrl.pathname,
      method: "POST",
      platform: resolveRequestPlatform(request),
      metadata: {
        holdId,
        code,
        sport: hold.courtConfig.sport,
        amount: hold.totalAmount,
      },
      error: result.error ?? "Invalid coupon",
    });
    return NextResponse.json(
      { success: false, error: result.error ?? "Invalid coupon" },
      { status: 400 }
    );
  }

  // Also reset any previously-applied points redemption — the
  // 20%-of-bill cap is computed off the post-coupon total, so the
  // slider needs a fresh preview after a coupon mutation. The web
  // action applyCouponToHold has the same null-out.
  await db.slotHold.update({
    where: { id: holdId },
    data: {
      couponId: result.couponId,
      couponCode: code.toUpperCase().trim(),
      discountAmount: result.discountAmount,
      pointsToRedeem: null,
      pointsRedeemPaiseSaved: null,
    },
  });

  logServerAction({
    userId: user.id,
    action: "booking.apply_coupon",
    category: AnalyticsCategory.BOOKING,
    outcome: "success",
    path: request.nextUrl.pathname,
    method: "POST",
    platform: resolveRequestPlatform(request),
    metadata: {
      holdId,
      code: code.toUpperCase().trim(),
      discountAmount: result.discountAmount,
      sport: hold.courtConfig.sport,
      amount: hold.totalAmount,
    },
  });

  return NextResponse.json({
    success: true,
    discountAmount: result.discountAmount,
    code: code.toUpperCase().trim(),
  });
}

// DELETE /api/mobile/booking/apply-coupon?holdId=... — clear any coupon
// previously applied to the hold. holdId travels in the query string rather
// than the body because DELETE-with-body isn't portable across fetch clients.
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
    data: {
      couponId: null,
      couponCode: null,
      discountAmount: null,
      // Same cap-base reset as the apply path.
      pointsToRedeem: null,
      pointsRedeemPaiseSaved: null,
    },
  });

  logServerAction({
    userId: user.id,
    action: "booking.clear_coupon",
    category: AnalyticsCategory.BOOKING,
    outcome: "success",
    path: request.nextUrl.pathname,
    method: "DELETE",
    platform: resolveRequestPlatform(request),
    metadata: { holdId, previousCode: hold.couponCode },
  });

  return NextResponse.json({ success: true });
}
