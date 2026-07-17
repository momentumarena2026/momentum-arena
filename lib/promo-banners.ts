import { db } from "@/lib/db";
import type { BannerPlacement } from "@prisma/client";

/**
 * Promotion banners — shared server plumbing for the customer render
 * slots (web pages + the mobile API) and the admin screens.
 *
 * A banner is LIVE when:
 *   - isActive
 *   - now inside its own [startsAt, endsAt] window (either side optional)
 *   - if a coupon is linked: the coupon is active AND now inside the
 *     coupon's validity window — i.e. the banner auto-retires with the
 *     promo it advertises (the "lives till the coupon is valid" rule).
 */

// Screen registry lives in lib/promo-banner-screens.ts (pure, client-safe).

export interface LivePromoBanner {
  id: string;
  title: string;
  imageUrl: string;
  appImageUrl: string | null;
  aspectRatio: number;
  linkUrl: string | null;
}

/** Live banners for one screen, sortOrder ASC. Never throws. */
export async function getLivePromoBanners(
  screen: BannerPlacement,
): Promise<LivePromoBanner[]> {
  const now = new Date();
  try {
    const rows = await db.promoBanner.findMany({
      where: {
        isActive: true,
        placement: { has: screen },
        OR: [{ startsAt: null }, { startsAt: { lte: now } }],
        AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
      },
      include: {
        coupon: {
          select: { isActive: true, validFrom: true, validUntil: true },
        },
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });
    return rows
      .filter(
        (b) =>
          !b.coupon ||
          (b.coupon.isActive &&
            b.coupon.validFrom <= now &&
            b.coupon.validUntil >= now),
      )
      .map((b) => ({
        id: b.id,
        title: b.title,
        imageUrl: b.imageUrl,
        appImageUrl: b.appImageUrl,
        aspectRatio: b.aspectRatio,
        linkUrl: b.linkUrl,
      }));
  } catch (err) {
    console.error("[promo-banners] live lookup failed", err);
    return [];
  }
}

/**
 * Sport relevance for SLOT_SELECTION placements: a banner whose link
 * targets a specific sport's booking flow (/book/<sport>...) should only
 * render on THAT sport's slot pages (the pickleball launch banner must
 * not appear over cricket slots). Sport-agnostic links always pass.
 */
const SPORT_SLUGS = ["cricket", "football", "pickleball"];
export function bannerRelevantToSport(
  linkUrl: string | null,
  sportSlug: string | null | undefined,
): boolean {
  if (!linkUrl || !sportSlug) return true;
  const target = SPORT_SLUGS.find((s) => linkUrl.includes(`/book/${s}`));
  return !target || target === sportSlug.toLowerCase();
}
