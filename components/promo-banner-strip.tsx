"use client";

import Link from "next/link";

/** Serialisable banner shape passed from server pages into client
 *  components (cafe menu, passes storefront). Mirrors LivePromoBanner. */
export interface PromoBannerData {
  id: string;
  title: string;
  imageUrl: string;
  aspectRatio: number;
  linkUrl: string | null;
}

/** Client-side render of live promo banners — same card look as the
 *  server PromoBannerSlot. Renders nothing for an empty list. */
export function PromoBannerStrip({
  banners,
  className = "",
}: {
  banners: PromoBannerData[];
  className?: string;
}) {
  if (!banners || banners.length === 0) return null;
  const frame =
    "group block overflow-hidden rounded-2xl border border-zinc-800 shadow-lg transition-all duration-300 hover:border-zinc-600";
  return (
    <div className={`space-y-4 ${className}`}>
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
