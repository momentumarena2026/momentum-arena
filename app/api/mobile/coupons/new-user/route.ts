import { NextRequest, NextResponse } from "next/server";
import { getMobileUser } from "@/lib/mobile-auth";
import { getNewUserDiscount } from "@/lib/new-user-discount";
import { getAutoApplyCouponCodes } from "@/actions/sport-promo";
import { getMobilePlatform } from "@/lib/mobile-auth";
import { BookingCategory, type Sport } from "@prisma/client";

// GET /api/mobile/coupons/new-user?sport=CRICKET&amount=2000&category=BOWLING_MACHINE
// Returns the new-user discount the server will auto-honour for this user
// (null if they already have a confirmed booking, no active system code, or
// the active code excludes this booking's category).
export async function GET(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const sport = searchParams.get("sport") as Sport | null;
  const amountStr = searchParams.get("amount");
  const amount = amountStr ? parseInt(amountStr, 10) : NaN;
  const categoryParam = searchParams.get("category");
  const bookingCategory =
    categoryParam && categoryParam in BookingCategory
      ? (categoryParam as BookingCategory)
      : null;

  if (!sport || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "sport and amount are required" },
      { status: 400 }
    );
  }

  try {
    const [discount, autoApplyCodes] = await Promise.all([
      getNewUserDiscount(user.id, sport, amount, bookingCategory),
      // Admin-flagged auto-apply coupons — the checkout tries these
      // BEFORE the new-user / fallback codes (event promos outrank the
      // welcome discount). Full validation happens on apply.
      getAutoApplyCouponCodes({
        sport,
        platform: getMobilePlatform(request),
      }).catch(() => [] as string[]),
    ]);
    return NextResponse.json({ discount, autoApplyCodes });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: 500 }
    );
  }
}
