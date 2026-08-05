/**
 * One place for the store identities.
 *
 * These were previously inlined in the tournament live-share route; a
 * second copy in the header/footer would be a third thing to forget when
 * an id changes, so both now read from here.
 */

/** Apple's numeric app id — also what the smart app banner needs. */
export const APPLE_APP_ID = "6783955158";
export const ANDROID_PACKAGE = "com.momentumarena";
/** Apple Developer Team ID. Public by design — it is published inside the
 *  apple-app-site-association file that enables Universal Links. */
export const APPLE_TEAM_ID = "WHF7M743MW";

/**
 * SHA-256 of the UPLOAD key (apps/mobile/android/app/upload-keystore.jks).
 * Not a secret — every assetlinks.json publishes its fingerprints; that is
 * the whole point of the file.
 *
 * This alone is NOT enough for production. Play App Signing means Google
 * re-signs the app with a DIFFERENT key, so installs from the Play Store
 * carry the app-signing key's fingerprint, not this one. Listing only this
 * makes App Links work on sideloaded/internal-test builds and fail
 * silently on real installs.
 *
 * Add the app-signing fingerprint via ANDROID_SHA256_FINGERPRINTS (comma-
 * separated, it is appended to this one). Play Console -> your app ->
 * Test and release -> Setup -> App integrity -> App signing key
 * certificate -> SHA-256 certificate fingerprint.
 */
export const ANDROID_UPLOAD_SHA256 =
  "35:3D:77:67:1B:E3:66:A3:E7:1C:F4:5B:C9:23:9F:65:46:38:77:28:71:F6:40:3B:F3:7A:37:B2:13:90:95:EC";

export const APP_STORE_URL = `https://apps.apple.com/app/id${APPLE_APP_ID}`;
export const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;

export type DevicePlatform = "ios" | "android" | "desktop";

/**
 * Which store badges a visitor should see.
 *
 * Resolved from the User-Agent on the SERVER, deliberately: doing it in
 * the browser means rendering the wrong set first and correcting it after
 * hydration, which is a visible flicker on exactly the element we're
 * asking people to click. Server-side it's just correct on the first
 * paint.
 *
 * iPadOS reports itself as a Mac, so it lands in "desktop" and gets both
 * badges — the honest answer, since the iPad App Store link works and we
 * can't reliably tell it apart from a real Mac without touch-point
 * sniffing that we'd only be doing to hide a link that isn't wrong.
 */
export function devicePlatform(userAgent: string | null): DevicePlatform {
  if (!userAgent) return "desktop";
  const ua = userAgent.toLowerCase();
  // Android must be checked first: Android UAs also contain "linux", and
  // some contain "mobile safari".
  if (ua.includes("android")) return "android";
  if (/iphone|ipod/.test(ua)) return "ios";
  // iPad running iOS < 13 still says "ipad"; newer ones say Macintosh.
  if (ua.includes("ipad")) return "ios";
  return "desktop";
}
