import { NextRequest, NextResponse } from "next/server";
import type { Sport } from "@prisma/client";
import { getMobileUser } from "@/lib/mobile-auth";
import { getRewardConfig } from "@/lib/rewards/config";

/**
 * GET /api/mobile/rewards/booking-earn-rate?sport=CRICKET
 *
 * Returns the basis-point earn rate that will actually fire for a
 * customer-originated booking on the given sport — pre-gated by
 * the same checks `awardBookingPoints` runs server-side (engine
 * enabled, rate > 0, sport on the enabled list when configured).
 *
 * Mobile CheckoutScreen calls this once on mount and recomputes the
 * projected earn locally as the bill total changes (coupon / points
 * redeem / advance toggles). Mirror of the web Booking Summary's
 * earn preview — same number both surfaces show.
 *
 * Returns `{ bps: 0 }` when rewards are off or this sport doesn't
 * earn, which the client uses as a signal to hide the line entirely.
 */
const ALLOWED_SPORTS = new Set<Sport>(["CRICKET", "FOOTBALL", "PICKLEBALL"]);

export async function GET(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sportRaw = request.nextUrl.searchParams.get("sport");
  if (!sportRaw || !ALLOWED_SPORTS.has(sportRaw as Sport)) {
    return NextResponse.json(
      { error: "Invalid sport" },
      { status: 400 },
    );
  }
  const sport = sportRaw as Sport;

  const cfg = await getRewardConfig();
  const allowed =
    cfg.enabled &&
    cfg.earnRateBookingBps > 0 &&
    (cfg.enabledSports.length === 0 || cfg.enabledSports.includes(sport));

  return NextResponse.json({
    bps: allowed ? cfg.earnRateBookingBps : 0,
  });
}
