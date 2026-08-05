/**
 * Edge-cache headers for public API responses.
 *
 * Our functions run in iad1 (Virginia) next to the Neon primary, but our
 * users are in India and enter through the bom1 edge. That means every
 * uncached call pays a Mumbai→Virginia→Mumbai round trip — ~250ms before
 * the handler does any work at all. On a cold app start we fire several
 * of these at once and the landing screen waits for all of them.
 *
 * For endpoints whose response is identical for every caller, letting
 * Vercel's CDN answer from Mumbai removes that hop entirely: a hit is
 * ~25ms instead of ~500ms. `stale-while-revalidate` means even the
 * refresh happens behind the user's back — nobody ever waits for it.
 *
 * ONLY use this on responses with no per-user content. Anything that
 * varies by the Bearer token must stay uncached, or one customer's data
 * would be served to the next.
 */

export interface PublicCacheOptions {
  /** Seconds the CDN may serve a response without asking again. */
  sMaxAge?: number;
  /** Seconds past that it may keep serving the stale copy while it
   *  refreshes in the background. */
  swr?: number;
}

export function publicCacheHeaders(opts: PublicCacheOptions = {}): HeadersInit {
  const sMaxAge = opts.sMaxAge ?? 60;
  const swr = opts.swr ?? 300;
  return {
    // max-age=0 keeps the phone itself from holding a stale copy we can't
    // purge; s-maxage is what the CDN obeys.
    "Cache-Control": `public, max-age=0, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`,
  };
}

/**
 * How long a given kind of payload may sit in the CDN.
 *
 * The numbers are chosen against how visible a stale read would be: a
 * tournament's seat count moving a minute late is invisible, an admin
 * flipping a module off wants to land quickly, so nothing here is longer
 * than a minute of hard freshness.
 */
export const CACHE = {
  /** Lists that change when an admin edits them: camps, tournaments. */
  catalog: publicCacheHeaders({ sMaxAge: 60, swr: 300 }),
  /** Banners and promos — cosmetic, safe to serve stale for longer. */
  promo: publicCacheHeaders({ sMaxAge: 120, swr: 600 }),
} as const;
