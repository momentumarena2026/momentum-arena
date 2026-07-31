import { NextRequest, NextResponse } from "next/server";
import { getPassPitchForCourtConfig } from "@/lib/passes";

// GET /api/mobile/pass-pitch?configId=… — "Play more, pay less" banner
// data for the slot-selection screens. Public (same posture as
// /api/mobile/sport-promo): it only exposes marketing numbers already
// visible on the passes storefront. `pitch` is null when the sport has
// no admin-designated cheapest-hour anchors (or none that save money).
export async function GET(request: NextRequest) {
  const configId = request.nextUrl.searchParams.get("configId");
  if (!configId) {
    return NextResponse.json({ error: "configId required" }, { status: 400 });
  }
  const pitch = await getPassPitchForCourtConfig(configId).catch(() => null);
  return NextResponse.json({ pitch });
}
