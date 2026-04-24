import { NextRequest, NextResponse } from "next/server";
import { getAvailableCoupons } from "@/actions/customer-coupons";

// GET /api/mobile/coupons/available?scope=SPORTS|CAFE|BOTH — public.
// Mirrors `getAvailableCoupons`, which the web's DiscountInput drawer
// uses to populate its "View available coupons" list. Runs
// unauthenticated (no user context affects the result) so the native
// checkout can show coupons even before sign-in.
export async function GET(request: NextRequest) {
  const scopeParam = request.nextUrl.searchParams.get("scope");
  const scope: "SPORTS" | "CAFE" | "BOTH" =
    scopeParam === "CAFE" || scopeParam === "BOTH" ? scopeParam : "SPORTS";

  const coupons = await getAvailableCoupons(scope);
  return NextResponse.json({ coupons });
}
