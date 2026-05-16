/**
 * Mobile-local mirror of web's `lib/auto-apply-promo.ts`.
 *
 * Mobile runs its own React Native bundle with no path alias to the web
 * /lib directory, so the types + pure helpers live here. The DB lookup
 * happens server-side via /api/mobile/sport-promo (mirror of web's
 * `actions/sport-promo.ts`), so this file stays pure / RN-safe.
 *
 * Keep IN SYNC with `lib/auto-apply-promo.ts` — both files have the
 * same shape and discount math so the web slot page and the mobile
 * BookSlotsScreen display identical numbers for the same coupon.
 */

export type DiscountType = "PERCENTAGE" | "FLAT";

export type ActiveSportPromo = {
  code: string;
  type: DiscountType;
  /** basis points (10000 = 100%) for PERCENTAGE, rupees for FLAT. */
  value: number;
  /**
   * Human-friendly percent (25 not 2500) — null for FLAT coupons or
   * any PERCENTAGE coupon with a `maxDiscount` cap. Slot-tile
   * decoration is gated on this being non-null.
   */
  percentOff: number | null;
};

/**
 * The per-slot (or per-amount) discount in rupees the user would
 * actually save. Mirrors the server's coupon-validation.ts:330 formula
 * (Math.floor) so the sum of per-slot discounts equals the whole-order
 * discount the user pays at checkout.
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
  return Math.min(amount, promo.value);
}
