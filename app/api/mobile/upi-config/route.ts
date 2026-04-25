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

  // Read either env var so the merchant only has to set one. The web
  // client also needs the VPA (for its own deep-link button), and the
  // simplest way to share it across web + mobile is the
  // `NEXT_PUBLIC_*` variant (Next.js inlines it into the client
  // bundle). Both names are honoured here so an existing
  // `MERCHANT_UPI_VPA` deployment keeps working.
  //
  // Trim defensively — VPAs frequently get pasted with stray whitespace
  // and treating "  q123@ybl  " as "q123@ybl" is the obvious right thing.
  const vpa =
    process.env.NEXT_PUBLIC_MERCHANT_UPI_VPA?.trim() ||
    process.env.MERCHANT_UPI_VPA?.trim() ||
    null;
  const payeeName =
    process.env.NEXT_PUBLIC_MERCHANT_UPI_NAME?.trim() ||
    process.env.MERCHANT_UPI_NAME?.trim() ||
    "Momentum Arena";

  return NextResponse.json({ vpa, payeeName });
}
