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
  /** SLOT_SELECTION refinement — empty = all sports. */
  slotSports: string[];
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
        slotSports: b.slotSports as string[],
      }));
  } catch (err) {
    console.error("[promo-banners] live lookup failed", err);
    return [];
  }
}

/**
 * Sport relevance for SLOT_SELECTION placements.
 *
 * Primary rule: the admin's explicit per-sport sub-list (slotSports) —
 * non-empty means "only these sports' slot pages". Empty falls back to
 * a linkUrl heuristic (a banner deep-linking /book/<sport> shouldn't
 * render over another sport's slots — covers pre-slotSports rows like
 * the seeded pickleball banner).
 */
const SPORT_SLUGS = ["cricket", "football", "pickleball"];
export function bannerRelevantToSport(
  banner: { linkUrl: string | null; slotSports: string[] },
  sportSlug: string | null | undefined,
): boolean {
  if (!sportSlug) return true;
  if (banner.slotSports.length > 0) {
    return banner.slotSports.includes(sportSlug.toUpperCase());
  }
  if (!banner.linkUrl) return true;
  const target = SPORT_SLUGS.find((s) => banner.linkUrl!.includes(`/book/${s}`));
  return !target || target === sportSlug.toLowerCase();
}
