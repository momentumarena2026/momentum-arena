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

export type DiscountType = "PERCENTAGE" | "FLAT" | "TARGET_PRICE";

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
 * actually save. Mirrors coupon-validation.ts's Math.floor so the sum
 * of per-slot discounts equals the whole-order discount.
 *
 * ── CALL THIS PER SLOT, NOT ON A TOTAL, FOR TARGET_PRICE ──────────────
 * PERCENTAGE is linear, so it gives the same answer either way and both
 * kinds of caller have always been fine. TARGET_PRICE is NOT: the
 * saving is (price − target) per slot, so handing it a three-hour total
 * of ₹6000 against a ₹1500 target returns ₹4500 instead of the correct
 * ₹1500. Use `computeAutoApplyDiscountForSlots` when you hold a list.
 */
export function computeAutoApplyDiscount(
  amount: number,
  promo: ActiveSportPromo,
): number {
  if (promo.type === "PERCENTAGE") {
    return Math.floor((amount * promo.value) / 10000);
  }
  if (promo.type === "TARGET_PRICE") {
    // `value` is the TARGET price for one slot, so the saving is
    // whatever this slot is over it. Floored at zero: a slot already
    // cheaper than the target is not raised to it, and does not
    // subsidise a dearer one.
    return Math.max(0, amount - promo.value);
  }
  // FLAT — coupon.value is the rupee amount (validator uses it directly
  // despite the schema's "paise" comment).
  return Math.min(amount, promo.value);
}

/**
 * The discount across a list of slot prices — the shape every caller
 * that holds the breakdown should use.
 *
 * For PERCENTAGE this is identical to calling the function above on the
 * sum. For TARGET_PRICE it is the only correct form. Having one helper
 * means a caller does not have to know which types are linear.
 */
export function computeAutoApplyDiscountForSlots(
  slotPrices: number[],
  promo: ActiveSportPromo,
): number {
  return slotPrices.reduce(
    (sum, price) => sum + computeAutoApplyDiscount(price, promo),
    0,
  );
}
