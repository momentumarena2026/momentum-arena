import { NextResponse } from "next/server";
import { getRainBanner } from "@/actions/admin-arena-settings";

/**
 * Public read of the "Rain doesn't slow us down" banner state for the
 * mobile app. Wraps the same `getRainBanner()` the web pages call, so
 * both surfaces resolve identically (AUTO weather-driven / ON / OFF,
 * controlled from /admin/pricing). No auth — it's public marketing copy.
 *
 * ISR-cached 5 min so admin toggles land promptly on mobile while the
 * DB read stays cheap; the expensive Open-Meteo call inside
 * `getMathuraRain()` has its own 15-min fetch cache, so the weather API
 * is never hit more than ~4×/hour regardless of app traffic.
 */
export const revalidate = 300;

export async function GET() {
  try {
    const banner = await getRainBanner();
    return NextResponse.json(banner);
  } catch {
    // The banner must never take an endpoint down — hide it on any error.
    return NextResponse.json({ show: false, title: "", body: "" });
  }
}
