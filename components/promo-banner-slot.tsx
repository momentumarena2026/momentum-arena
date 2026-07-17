import Link from "next/link";
import { getLivePromoBanners, bannerRelevantToSport } from "@/lib/promo-banners";
import type { BannerPlacement } from "@prisma/client";

/**
 * Server component — renders the LIVE promotion banners targeted at
 * `screen` (admin: Web & App Config → Promotion Banners). Renders
 * nothing when no banner is live, so pages can mount it unconditionally.
 *
 * variant "card" (default): rounded, bordered, page-width — used below
 * a page's title/subtitle. variant "top": edge-to-edge strip for the
 * homepage HOME_TOP position above the logo.
 *
 * Plain <img> by design: banner images live on Vercel Blob and
 * next/image would need a remotePatterns entry per store domain —
 * the upload route already serves pre-optimised webp variants.
 */
export async function PromoBannerSlot({
  screen,
  variant = "card",
  className = "",
  sportSlug,
}: {
  screen: BannerPlacement;
  variant?: "card" | "top";
  className?: string;
  /** SLOT_SELECTION pages pass the current sport so sport-specific
   *  banners (link → /book/<sport>) only show on their own sport. */
  sportSlug?: string;
}) {
  const banners = (await getLivePromoBanners(screen)).filter((b) =>
    bannerRelevantToSport(b, sportSlug),
  );
  if (banners.length === 0) return null;

  // Same card chrome as the pickleball launch banner: rounded, subtle
  // border + shadow, gentle zoom on hover. The "top" variant only adds
  // a page-width container so the card doesn't run edge-to-edge.
  // Natural image height (h-auto) — never force the stored ratio onto
  // the <img>, a mismatched value would crop/squash the artwork (the
  // ratio is only needed by the APP to reserve layout).
  const frame =
    "group block overflow-hidden rounded-2xl border border-zinc-800 shadow-lg transition-all duration-300 hover:border-zinc-600";

  return (
    <div
      className={
        variant === "top"
          ? `mx-auto w-full max-w-7xl space-y-4 px-4 pt-4 sm:px-6 lg:px-8 ${className}`
          : `space-y-4 ${className}`
      }
    >
      {banners.map((b) => {
        const img = (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={b.imageUrl}
            alt={b.title}
            className="h-auto w-full transition-transform duration-500 group-hover:scale-[1.01]"
          />
        );
        return b.linkUrl ? (
          <Link key={b.id} href={b.linkUrl} aria-label={b.title} className={frame}>
            {img}
          </Link>
        ) : (
          <div key={b.id} className={frame}>
            {img}
          </div>
        );
      })}
    </div>
  );
}
