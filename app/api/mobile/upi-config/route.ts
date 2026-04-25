import { NextRequest, NextResponse } from "next/server";
import { getMobileUser } from "@/lib/mobile-auth";

/**
 * GET /api/mobile/upi-config
 *
 * Returns the merchant's UPI VPA and display name so the mobile app can
 * build a `upi://pay?pa=…&pn=…&am=…&cu=INR&tn=…` deep link. That deep
 * link is what lets a user pay with a UPI app installed on the same
 * device they're booking from — instead of asking them to scan a QR
 * with a second phone or save the QR to their gallery.
 *
 * The VPA is sourced from env (`MERCHANT_UPI_VPA`) so it doesn't have
 * to live in the repo. When unset, we return `vpa: null` and the
 * mobile app falls back to the existing QR + WhatsApp-screenshot flow.
 *
 * Cache: client-side via React Query. Re-issued every login, but the
 * value rarely changes — staleTime can safely be many minutes.
 */
export async function GET(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Trim defensively — VPAs frequently get pasted with stray whitespace
  // and treating "  q123@ybl  " as "q123@ybl" is the obvious right thing.
  const vpa = process.env.MERCHANT_UPI_VPA?.trim() || null;
  const payeeName =
    process.env.MERCHANT_UPI_NAME?.trim() || "Momentum Arena";

  return NextResponse.json({ vpa, payeeName });
}
