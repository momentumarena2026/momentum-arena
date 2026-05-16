"use server";

/**
 * Server-side lookup for the active auto-apply promo on a given sport.
 *
 * Lives in /actions because it touches the DB and must stay server-only;
 * the pure helpers + types it returns are in lib/auto-apply-promo.ts so
 * client components (SlotGrid, etc.) can use the types without pulling
 * in `@/lib/db`.
 *
 * Used by:
 *   - app/book/[sport]/[configId]/page.tsx — to decide whether to show
 *     the "Launch offer: X% off" banner + strike-through slot prices.
 */

import { db } from "@/lib/db";
import { BookingCategory, Sport } from "@prisma/client";
import {
  type ActiveSportPromo,
  getAutoApplyCodeForSport,
} from "@/lib/auto-apply-promo";

/**
 * Returns the auto-apply promo for `sport` if it's currently live AND
 * would be applicable to an anonymous visitor browsing the slot page.
 * Anything user-specific (FIRST_TIME, BIRTHDAY, eligibleUsers,
 * eligibleGroups) is treated as a disqualifier — we don't promise a
 * discount on the slot tiles that the user might not actually get.
 *
 * Caller passes `bookingCategory` for sports with sub-flows (today only
 * CRICKET has BOX_CRICKET / BOWLING_MACHINE). Lets us hide the promo on
 * bowling-machine slots when the coupon has `categoryExclude` set.
 */
export async function getActiveSportPromo(
  sport: Sport,
  bookingCategory?: BookingCategory | null,
): Promise<ActiveSportPromo | null> {
  const code = getAutoApplyCodeForSport(sport);
  const coupon = await db.coupon.findUnique({
    where: { code },
    include: {
      _count: { select: { eligibleUsers: true, eligibleGroups: true } },
    },
  });
  if (!coupon || !coupon.isActive) return null;

  const now = new Date();
  if (coupon.validFrom > now || coupon.validUntil < now) return null;

  // Mirrors validateCoupon's pre-flight checks (steps 4–8 there).
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) return null;
  if (coupon.sportFilter.length > 0 && !coupon.sportFilter.includes(sport)) return null;
  if (
    bookingCategory &&
    coupon.categoryExclude.length > 0 &&
    coupon.categoryExclude.includes(bookingCategory)
  ) {
    return null;
  }

  // User-specific gates: if any of these are set, we can't promise the
  // discount to an anonymous visitor, so don't decorate the slots.
  // (Checkout still tries to validate at apply-time — it'll just no-op
  // for users who don't qualify, same as today.)
  if (coupon.userGroupFilter.length > 0) return null;
  if (coupon._count.eligibleUsers > 0 || coupon._count.eligibleGroups > 0) {
    return null;
  }

  // maxDiscount cap on percentage coupons would make per-slot display
  // diverge from the whole-amount checkout discount at large totals, so
  // suppress per-slot decoration in that case (percentOff stays null;
  // banner won't render either).
  const isCapped = coupon.type === "PERCENTAGE" && coupon.maxDiscount !== null;
  const percentOff =
    coupon.type === "PERCENTAGE" && !isCapped ? coupon.value / 100 : null;

  return {
    code: coupon.code,
    type: coupon.type,
    value: coupon.value,
    percentOff,
  };
}
