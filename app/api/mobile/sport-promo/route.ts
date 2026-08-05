import { NextRequest, NextResponse } from "next/server";
import { BookingCategory, Sport } from "@prisma/client";
import { getActiveSportPromo } from "@/actions/sport-promo";
import { getAuthUserId } from "@/lib/auth-unified";
import { getMobilePlatform } from "@/lib/mobile-auth";
import { logBookingRequest } from "@/lib/server-log";

// Returns the active auto-apply promo for `sport` (and optional
// `bookingCategory`), or null if no live coupon qualifies. Mobile
// equivalent of what the web slot page (app/book/[sport]/[configId]/page.tsx)
// fetches server-side.
//
// Shape mirrors lib/auto-apply-promo.ts:ActiveSportPromo so the mobile
// client can use the same types/discount-math helpers locally without
// the round-trip ever being a source of drift — both web and mobile
// read the SAME coupon row through the SAME `getActiveSportPromo`.
//
// Public, no auth: the discount info is already visible on the web slot
// page to any anonymous browser; gating it behind sign-in would mean
// the mobile slot screen has no way to render the banner/decoration
// until the user signs in.
//
// Deliberately NOT edge-cached, unlike the other public mobile GETs:
// the answer depends on the caller's platform (an App-only coupon must
// not leak to the web build), and a CDN keyed on the URL alone would
// hand an iOS response to an Android device.
export async function GET(request: NextRequest) {
  const sport = request.nextUrl.searchParams.get("sport");
  const bookingCategory = request.nextUrl.searchParams.get("bookingCategory");

  if (!sport) {
    logBookingRequest(request, "booking.view_sport_promo", "error", {
      // Resolved here rather than up front: on the happy path it runs
      // alongside the promo query instead of ahead of it.
      userId: await getAuthUserId(request).catch(() => null),
      error: "Sport is required",
    });
    return NextResponse.json({ error: "Sport is required" }, { status: 400 });
  }

  // The promo lookup doesn't need the caller's identity — userId is only
  // for the log line below — so resolving the token used to add a hop in
  // front of the query for no reason. Both go at once.
  const [userId, promo] = await Promise.all([
    getAuthUserId(request).catch(() => null),
    getActiveSportPromo(
      sport as Sport,
      (bookingCategory as BookingCategory | null) || undefined,
      getMobilePlatform(request),
    ),
  ]);

  logBookingRequest(request, "booking.view_sport_promo", "success", {
    userId,
    metadata: {
      sport,
      bookingCategory,
      hasPromo: !!promo,
      promoCode: promo?.code ?? null,
    },
  });

  return NextResponse.json({ promo });
}
