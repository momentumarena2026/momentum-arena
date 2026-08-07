import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * XML sitemap for crawlers (Google / Bing / Yandex).
 *
 * Only public, indexable, *valuable* pages live here. Auth-gated
 * pages (`/dashboard`, `/bookings`, `/profile`, `/waitlist`,
 * `/referral`), admin (`/admin/*`, `/godmode/*`), API routes, and
 * transient checkout/confirmation flows are intentionally absent.
 * Those are also blocked in robots.ts as a belt-and-suspenders move.
 *
 * `lastModified` is currently the build timestamp. If you want
 * per-page granularity later (e.g. `/coupons` changing whenever a
 * new DiscountCode is issued), switch the per-entry `lastModified`
 * to a Prisma query — `db.discountCode.findFirst({ orderBy: {
 * updatedAt: "desc" }})` etc.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = SITE_URL;
  const now = new Date();

  // Sport list — matches the Sport enum in prisma/schema.prisma. If
  // you add a sport, add it here too. Hard-coded (vs db.sport.findMany)
  // because the enum values are stable + listing them at build time
  // keeps the sitemap response synchronous.
  const sports = ["cricket", "football", "pickleball"] as const;

  return [
    // ── Top-level discovery surfaces ─────────────────────────────
    {
      url: base,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1.0,
    },
    {
      url: `${base}/book`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.9,
    },

    // ── Per-sport landing pages — high SEO value targets ────────
    // ("cricket turf booking Mathura", "pickleball court Mathura"…)
    ...sports.map((sport) => ({
      url: `${base}/book/${sport}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.9,
    })),

    // ── Cafe / loyalty / promotions ─────────────────────────────
    {
      url: `${base}/cafe`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: `${base}/coupons`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.7,
    },
    // `/rewards` intentionally absent — auth-gated user surface
    // (Momentum Points balance + activity). Stays in robots.ts
    // disallow alongside other authed pages.

    // ── Help / support / legal ──────────────────────────────────
    {
      url: `${base}/faq`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: `${base}/policies`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },

    // ── Sign-in entry point — low priority but useful for branded
    //    "momentum arena login" queries.
    {
      url: `${base}/login`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.4,
    },
  ];
}
