import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import { previewRedemption } from "@/lib/rewards/redeem";

/** Max redeemable points for a given entry-fee amount (₹). Drives the
 *  "use my points" checkbox on web + app registration. Unified auth. */
export async function GET(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) return NextResponse.json({ maxPoints: 0, maxPaise: 0 });
  const amount = parseInt(request.nextUrl.searchParams.get("amount") || "0", 10);
  if (!amount || amount <= 0) return NextResponse.json({ maxPoints: 0, maxPaise: 0 });
  const preview = await previewRedemption({ userId, billPaise: amount * 100 });
  return NextResponse.json({
    maxPoints: preview.maxPoints,
    maxPaise: preview.maxPaise,
    blockedReason: preview.blockedReason || null,
  });
}
