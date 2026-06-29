/**
 * Shared helpers for coupon platform restrictions, used by BOTH coupon
 * systems — the unified booking Coupon (actions/coupon-validation.ts) and the
 * cafe CafeDiscount (actions/cafe-orders.ts). Kept in a plain (non-"use
 * server") module so it can be imported into server actions, which may only
 * EXPORT async functions.
 *
 * A coupon's `validPlatforms` is an array of "web" | "android" | "ios".
 * Empty = valid on every platform (default, backward-compatible). Otherwise
 * the redeeming platform must be in the list. "App-only" = ["android","ios"].
 */
export type CouponPlatform = "web" | "android" | "ios";

/** True when a coupon with these `validPlatforms` may be redeemed on `platform`. */
export function isPlatformAllowed(
  validPlatforms: string[],
  platform: CouponPlatform | undefined,
): boolean {
  if (validPlatforms.length === 0) return true;
  return !!platform && validPlatforms.includes(platform);
}

/** Friendly rejection message tailored to which platforms a coupon allows. */
export function platformRestrictionMessage(platforms: string[]): string {
  const set = new Set(platforms);
  const isApp = set.has("android") || set.has("ios");
  const isWeb = set.has("web");
  if (isApp && !isWeb) {
    if (set.has("ios") && !set.has("android")) {
      return "This coupon is only valid in the iOS app";
    }
    if (set.has("android") && !set.has("ios")) {
      return "This coupon is only valid in the Android app";
    }
    return "This coupon is only valid in the Momentum Arena app";
  }
  if (isWeb && !isApp) return "This coupon is only valid on the website";
  return "This coupon is not valid on this platform";
}
