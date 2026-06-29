/**
 * Sport-specific auto-apply promo — pure helpers and types.
 *
 * No DB imports — this file is safe to import from client components.
 * The DB lookup lives in `actions/sport-promo.ts` (`getActiveSportPromo`)
 * because it touches `lib/db` and must stay server-only.
 *
 * Single source of truth for two questions the rest of the app keeps
 * asking:
 *   1. "Which coupon code should checkout auto-apply for this sport?"
 *      Web + mobile checkout used to hardcode this in two places; both
 *      now call `getAutoApplyCodeForSport`.
 *   2. "How much discount does this promo give on this amount?"
 *      Per-slot tile decoration on the pickleball slot page uses the
 *      same Math.floor formula as the server-side validator (see
 *      coupon-validation.ts:330) so the displayed total = the amount
 *      the user pays at checkout.
 */

import { DiscountType, Sport } from "@prisma/client";

/**
 * Which coupon code does checkout auto-apply for each sport.
 *
 * Pickleball gets the launch promo (PICKLEBALL25, sport-filtered). Every
 * other sport falls back to FLAT100. Picked by sport instead of trying
 * codes in order because FLAT100 isn't sport-filtered and would shadow
 * the pickleball promo if tried first.
 *
 * Returns a code even when the coupon isn't live (or doesn't exist) —
 * the consuming surfaces (checkout + slot page) call validateCoupon /
 * getActiveSportPromo, which gracefully no-op when the row is missing
 * or disabled.
 */
export function getAutoApplyCodeForSport(
  sport: Sport | string | null | undefined,
): string {
  return sport === "PICKLEBALL" ? "PICKLEBALL25" : "FLAT100";
}

/**
 * Coupon code the MOBILE app checkout auto-attempts FIRST, for a customer's
 * very first app booking. The coupon must be created by an admin with this
 * code, configured App-only (validPlatforms ["android","ios"]) and a
 * FIRST_APP_BOOKING condition. validateCoupon enforces eligibility, so the
 * checkout can attempt it unconditionally — it silently no-ops for users who
 * aren't on their first app booking. Tried ahead of the new-user / sport
 * fallback codes so the app-adoption promo wins when both could apply.
 *
 * The mobile CheckoutScreen mirrors this constant locally (it can't import
 * the web package); keep the two in sync.
 */
export const APP_FIRST_BOOKING_CODE = "APPFIRST";

export type ActiveSportPromo = {
  code: string;
  type: DiscountType;
  /** basis points (10000 = 100%) for PERCENTAGE, rupees for FLAT. */
  value: number;
  /**
   * Human-friendly percent (25 not 2500) — null for FLAT coupons or
   * any PERCENTAGE coupon with a `maxDiscount` cap (because the cap
   * would make per-slot display diverge from the whole-amount checkout
   * discount at large totals). Slot-tile decoration is gated on this
   * being non-null.
   */
  percentOff: number | null;
};

/**
 * The per-slot (or per-amount) discount in rupees the user would
 * actually save. Mirrors coupon-validation.ts:330's Math.floor so the
 * sum of per-slot discounts equals the whole-order discount.
 */
export function computeAutoApplyDiscount(
  amount: number,
  promo: ActiveSportPromo,
): number {
  if (promo.type === "PERCENTAGE") {
    return Math.floor((amount * promo.value) / 10000);
  }
  // FLAT — coupon.value is the rupee amount (validator uses it directly
  // at coupon-validation.ts:336 despite the schema's "paise" comment).
  // We don't actually display flat-promo decorations per slot today
  // (percentOff gating above), but keep the math correct in case a
  // caller passes a flat promo.
  return Math.min(amount, promo.value);
}
