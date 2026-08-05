import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { listAdminBookingCoupons } from "@/lib/admin-coupon-options";

/**
 * GET /api/mobile/admin/bookings/coupon-options?sport=PICKLEBALL&category=
 *
 * The coupons the app's create-booking screen may offer. Same list the
 * web form shows (shared helper), gated on MANAGE_BOOKINGS because it
 * serves the booking desk, not the coupons admin.
 */
export async function GET(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_BOOKINGS");
  if ("error" in gate) return gate.error;

  const url = new URL(request.url);
  const sport = url.searchParams.get("sport");
  if (!sport) {
    return NextResponse.json({ error: "Missing sport" }, { status: 400 });
  }
  const category = url.searchParams.get("category");

  const coupons = await listAdminBookingCoupons(sport, category).catch(() => []);
  return NextResponse.json({ coupons });
}
