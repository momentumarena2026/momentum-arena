/**
 * Pickleball launch promo pricing — mirrors PICKLEBALL25 (25% PERCENTAGE) for
 * display on the slot-selection screen. Sport checks live in `@/lib/sport`.
 */
export const PICKLEBALL_LAUNCH_DISCOUNT_BPS = 2500;

/** Discount amount in rupees (matches validateCoupon PERCENTAGE math). */
export function pickleballLaunchDiscountAmount(priceRupees: number): number {
  return Math.floor((priceRupees * PICKLEBALL_LAUNCH_DISCOUNT_BPS) / 10000);
}

export function applyPickleballLaunchDiscount(priceRupees: number): number {
  return priceRupees - pickleballLaunchDiscountAmount(priceRupees);
}
