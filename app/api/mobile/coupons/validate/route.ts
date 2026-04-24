import { NextRequest, NextResponse } from "next/server";
import { getMobileUser } from "@/lib/mobile-auth";
import { validateCoupon } from "@/actions/coupon-validation";
import type { Sport } from "@prisma/client";

// POST /api/mobile/coupons/validate — HTTP wrapper around validateCoupon.
// Returns { valid, discountAmount?, couponId?, error? } so the native
// checkout screen can decide whether to persist the coupon to the hold.
export async function POST(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    code?: string;
    scope?: "SPORTS" | "CAFE";
    amount?: number;
    sport?: Sport;
    categories?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { code, scope = "SPORTS", amount, sport, categories } = body;
  if (!code || typeof amount !== "number") {
    return NextResponse.json({ error: "Missing code or amount" }, { status: 400 });
  }

  const result = await validateCoupon(code, {
    scope,
    amount,
    userId: user.id,
    sport,
    categories,
  });

  return NextResponse.json(result);
}
