import { NextRequest, NextResponse } from "next/server";
import { BookingCategory, Sport } from "@prisma/client";
import { getActiveSportPromo } from "@/actions/sport-promo";

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
export async function GET(request: NextRequest) {
  const sport = request.nextUrl.searchParams.get("sport");
  const bookingCategory = request.nextUrl.searchParams.get("bookingCategory");

  if (!sport) {
    return NextResponse.json({ error: "Sport is required" }, { status: 400 });
  }

  // Cast is safe: invalid sport just produces null from getActiveSportPromo
  // (sportFilter mismatch). Callers shouldn't be sending garbage anyway.
  const promo = await getActiveSportPromo(
    sport as Sport,
    (bookingCategory as BookingCategory | null) || undefined,
  );

  return NextResponse.json({ promo });
}
