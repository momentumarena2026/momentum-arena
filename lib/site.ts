/**
 * The canonical public origin, in one place.
 *
 * www, not the apex. That is the host the site actually serves from:
 * momentumarena.com redirects here for every path except /.well-known/
 * (see next.config.ts), the GA4 production check in lib/analytics.ts keys
 * on it, and the customer SMS links in lib/notifications.ts are registered
 * against it in DLT — which makes it the one host that cannot move.
 *
 * This exists because the origin used to be written out as a literal in a
 * dozen places, half of them apex and half www. That disagreement is what
 * broke Android App Links verification: the apex was redirecting, so
 * Google's fetch of /.well-known/assetlinks.json got a 307 and failed the
 * domain. Import this instead of typing the host again.
 *
 * Runtime env still wins where it is set (NEXT_PUBLIC_APP_URL and friends)
 * so local dev and preview deployments point at themselves.
 */
export const SITE_URL = "https://www.momentumarena.com";
