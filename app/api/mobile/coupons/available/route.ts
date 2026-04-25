import { NextRequest, NextResponse } from "next/server";
import {
  getAvailableCoupons,
  getPersonalizedCouponsForUser,
} from "@/actions/customer-coupons";
import { getMobileUser } from "@/lib/mobile-auth";

// GET /api/mobile/coupons/available?scope=SPORTS|CAFE|BOTH
//
// Returns the union of:
//   - public, non-targeted coupons (always)
//   - the caller's personalized coupons (when the request carries a
//     valid mobile JWT) — auto-eligibility groups (FIRST_TIME,
//     BIRTHDAY_MONTH, …) plus admin-targeted offers (direct user
//     assignment or group membership)
//
// Auth is optional: anonymous callers still get the public list, so
// the native checkout can show coupons before sign-in. Once the user
// is signed in, this endpoint is what makes private offers visible
// to their intended audience — admin-targeted coupons are filtered
// out of the public list server-side, so the only way they reach
// the mobile UI is via the personalized merge below.
export async function GET(request: NextRequest) {
  const scopeParam = request.nextUrl.searchParams.get("scope");
  const scope: "SPORTS" | "CAFE" | "BOTH" =
    scopeParam === "CAFE" || scopeParam === "BOTH" ? scopeParam : "SPORTS";

  const user = await getMobileUser(request);

  const [publicCoupons, personalized] = await Promise.all([
    getAvailableCoupons(scope),
    user ? getPersonalizedCouponsForUser(user.id) : null,
  ]);

  if (!personalized) {
    return NextResponse.json({ coupons: publicCoupons });
  }

  // Dedupe by id — a personalized auto-eligibility coupon could in
  // theory also be a public coupon (admin set both flags), and we
  // don't want it to render twice in the drawer.
  const merged = [
    ...publicCoupons,
    ...personalized.birthdayCoupons,
    ...personalized.firstTimeCoupons,
    ...personalized.groupCoupons,
    ...personalized.targetedCoupons,
  ];
  const seen = new Set<string>();
  const coupons = merged.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });

  return NextResponse.json({ coupons });
}
