import { NextRequest, NextResponse } from "next/server";
import { getLivePromoBanners, bannerRelevantToSport } from "@/lib/promo-banners";
import type { BannerPlacement } from "@prisma/client";
import { CACHE } from "@/lib/api-cache";

const VALID = new Set([
  "HOME_TOP",
  "HOME_PROMO",
  "BOOK_SPORT",
  "SLOT_SELECTION",
  "CAFE",
  "SHOP",
  "PASSES",
]);

/**
 * GET /api/mobile/promo-banners?screen=HOME_TOP
 *
 * Public (banners are marketing content — no auth). Returns the LIVE
 * banners for one screen. Site-relative image/link paths (seeded
 * /public assets) are absolutised against this request's origin so the
 * app can load them directly.
 */
export async function GET(request: NextRequest) {
  const screen = request.nextUrl.searchParams.get("screen") ?? "";
  if (!VALID.has(screen)) {
    return NextResponse.json({ error: "Invalid screen" }, { status: 400 });
  }

  const fwdHost =
    request.headers.get("x-forwarded-host") || request.headers.get("host");
  const fwdProto = request.headers.get("x-forwarded-proto") || "https";
  const origin = fwdHost ? `${fwdProto}://${fwdHost}` : "";
  const absolutise = (u: string | null) =>
    u && u.startsWith("/") ? `${origin}${u}` : u;

  // Optional sport slug (slot screens) — sport-specific banners only
  // render on their own sport.
  const sport = request.nextUrl.searchParams.get("sport");
  const banners = (await getLivePromoBanners(screen as BannerPlacement)).filter(
    (b) => bannerRelevantToSport(b, sport),
  );
  return NextResponse.json({
    banners: banners.map((b) => ({
      id: b.id,
      title: b.title,
      // App-optimised variant when the upload produced one; seeded
      // /public banners have a single asset.
      imageUrl: absolutise(b.appImageUrl ?? b.imageUrl),
      aspectRatio: b.aspectRatio,
      linkUrl: b.linkUrl,
    })),
  }, { headers: CACHE.promo });
}
