import type { MetadataRoute } from "next";

/**
 * robots.txt for crawler access control.
 *
 * Allow everything by default, then explicitly disallow:
 *  - Admin (/admin/*, /godmode/*) — sensitive ops surface, would
 *    leak booking data + admin URLs into search results.
 *  - API routes — they return JSON, not HTML; indexing them is
 *    pointless and noisy.
 *  - Auth-gated customer pages — the crawler will just get
 *    redirected to /login; cleaner to tell it not to bother.
 *  - Transient checkout / confirmation flows — single-use URLs,
 *    no SEO value, and confirmation pages contain booking ids
 *    we don't want indexed.
 *
 * Cross-checked against app/sitemap.ts — every URL emitted by the
 * sitemap is allowed here, every disallowed path is absent from
 * the sitemap.
 */
export default function robots(): MetadataRoute.Robots {
  const base = "https://momentumarena.com";

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          // Admin surfaces
          "/admin/",
          "/godmode/",
          // Internals — JSON, generators, dev tooling
          "/api/",
          "/generator/",
          // Auth-gated customer pages — Google would just see a
          // redirect to /login, no point in crawling them
          "/dashboard",
          "/bookings",
          "/profile",
          "/referral",
          "/waitlist",
          // Transient flows — single-use URLs that change per
          // booking and have no SEO value
          "/book/checkout",
          "/book/confirmation",
          "/cafe/checkout",
          "/cafe/orders",
          // Rewards is disabled while it's being redesigned — page
          // returns 404, also stripped from sitemap.ts. Remove this
          // entry when the new surface ships.
          "/rewards",
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
