"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { CouponScope } from "@prisma/client";
import {
  isPlatformAllowed,
  platformRestrictionMessage,
} from "@/lib/coupon-platform";
import { holdPayableSlotPrices } from "@/lib/booking-amounts";
import { requireAdmin } from "@/lib/admin-auth";

export interface CouponValidationResult {
  valid: boolean;
  discountAmount?: number;
  error?: string;
  couponId?: string;
}

interface ValidateCouponContext {
  scope: "SPORTS" | "CAFE";
  amount: number;
  userId?: string;
  sport?: string;
  categories?: string[];
  /**
   * The platform the coupon is being redeemed from: "web" | "android" | "ios".
   * Drives the coupon's `validPlatforms` restriction and the FIRST_APP_BOOKING
   * condition. Defaults to undefined (treated as "not app") when a caller
   * doesn't supply it — every real call site passes it.
   */
  platform?: "web" | "android" | "ios";
  /**
   * Sub-category of the booking being validated against (BOX_CRICKET
   * or BOWLING_MACHINE). When a coupon's `categoryExclude` contains
   * this value the coupon is rejected. Optional so cafe/check-coupon
   * paths that don't have a booking-category in context still work.
   */
  bookingCategory?: "BOX_CRICKET" | "BOWLING_MACHINE" | null;
  /**
   * The booking's PLAY DATE (SlotHold.date / Booking.date — stored at
   * calendar-date midnight). Drives the BOOKING_DATE condition, which
   * restricts a coupon to bookings ON specific days (event promos).
   * Callers with no booking in context (cafe, code browsing) omit it —
   * a BOOKING_DATE coupon then rejects with a clear error.
   */
  bookingDate?: Date | null;
  /**
   * The SlotHold being checked out. Needed only by TARGET_PRICE
   * coupons, which price per slot and so cannot be computed from
   * `amount`; the per-slot breakdown is read from this hold HERE,
   * server-side.
   *
   * ── WHY AN ID AND NOT THE PRICES ──────────────────────────────────
   * `validateCoupon` is a server ACTION: the web checkout and the
   * coupon drawer call it straight from the browser, so every field on
   * this context is attacker-controlled. Taking `number[]` of slot
   * prices would let a client post `[999999]` and mint its own
   * discount. An id cannot — it is looked up against the database and
   * scoped to `userId`, so a caller can only ever describe a hold that
   * is really theirs. Same principle as lib/booking-amounts.ts, where
   * the client's amount is a hint and never the charge.
   *
   * TARGET_PRICE REFUSES when this is absent. Failing closed is
   * deliberate: pricing it off a total would subtract the target once
   * instead of once per slot, so a three-hour booking at a ₹1500
   * target would take ₹4500 off instead of ₹1500. Cafe, tournament and
   * camp scopes have no hold and so can never satisfy such a coupon,
   * which is correct — the offer is priced per hour of court time.
   */
  holdId?: string;
  /**
   * Per-slot prices, whole rupees, for a TARGET_PRICE coupon on a
   * booking that has NO SlotHold — today only the admin counter path
   * (`actions/admin-booking.ts`), which prices the slots itself from
   * PricingRule and then creates the booking directly.
   *
   * ── HONOURED ONLY FOR AN AUTHENTICATED ADMIN ──────────────────────
   * `validateCoupon` is a server action, so this field arrives from the
   * client like every other. It is therefore checked against an admin
   * session before being believed — see `payableSlotPrices`. Without
   * that gate it would be a self-service discount: post any prices you
   * like and read back the saving.
   *
   * The gate is the SESSION, never the argument. This file does not get
   * a `trusted: true` parameter, for the reason spelled out at length
   * in lib/admin-auth.ts: in a "use server" module every argument is
   * attacker-controlled, so a flag that decides whether a check runs is
   * a bypass with extra steps.
   *
   * Customer paths must leave this unset and pass `holdId` instead,
   * which is non-forgeable because the hold is looked up scoped to the
   * user.
   */
  adminSlotBasePrices?: number[];
}

/**
 * The hold's per-slot prices, read from the database and scoped to the
 * user the context claims to be.
 *
 * Returns [] for anything that is not a live hold belonging to this
 * user, which makes a TARGET_PRICE coupon refuse. The `userId` filter
 * is the security boundary: without it a caller could name somebody
 * else's expensive hold to size their own discount.
 */
async function payableSlotPrices(
  context: ValidateCouponContext,
): Promise<number[]> {
  if (context.holdId && context.userId) {
    const hold = await db.slotHold.findFirst({
      where: { id: context.holdId, userId: context.userId },
      select: { slotPrices: true, passModeId: true, passModeCoverage: true, totalAmount: true },
    });
    if (hold) return holdPayableSlotPrices(hold);
    return [];
  }

  // The admin counter path, which has prices but no hold. Believed only
  // behind a real admin session — see `adminSlotBasePrices`.
  const supplied = context.adminSlotBasePrices;
  if (supplied && supplied.length > 0) {
    try {
      await requireAdmin();
    } catch {
      return [];
    }
    // Shape-check what an admin sent, so a malformed form submission
    // cannot produce a NaN discount that later reads as a free booking.
    if (!supplied.every((p) => Number.isInteger(p) && p >= 0)) return [];
    return supplied;
  }

  return [];
}

export async function validateCoupon(
  code: string,
  context: ValidateCouponContext
): Promise<CouponValidationResult> {
  try {
    const upperCode = code.toUpperCase().trim();
    const now = new Date();

    // Fall back to the logged-in session's user id when the caller didn't
    // pass one explicitly. Without this, userGroupFilter and FIRST_PURCHASE
    // checks can't distinguish "guest" from "logged-in first-time user" and
    // everyone ends up with "You must be logged in to use this coupon".
    if (!context.userId) {
      const session = await auth();
      if (session?.user?.id) {
        context = { ...context, userId: session.user.id };
      }
    }

    // 1. Find coupon case-insensitive
    const coupon = await db.coupon.findFirst({
      where: { code: upperCode },
      include: {
        conditions: true,
        eligibleUsers: { select: { userId: true } },
        eligibleGroups: { select: { groupId: true } },
      },
    });

    if (!coupon) {
      return { valid: false, error: "Invalid coupon code" };
    }

    // 2. Check isActive, validFrom <= now <= validUntil
    if (!coupon.isActive) {
      return { valid: false, error: "This coupon is no longer active" };
    }
    if (now < coupon.validFrom) {
      return { valid: false, error: "This coupon is not yet valid" };
    }
    if (now > coupon.validUntil) {
      return { valid: false, error: "This coupon has expired" };
    }

    // 3. Check scope matches (BOTH matches everything)
    if (coupon.scope !== "BOTH" && coupon.scope !== context.scope) {
      return {
        valid: false,
        error: `This coupon is only valid for ${coupon.scope.toLowerCase()}`,
      };
    }

    // 3b. Platform restriction. Empty validPlatforms = valid on every
    // platform (default). Otherwise the redeeming platform must be listed.
    if (!isPlatformAllowed(coupon.validPlatforms, context.platform)) {
      return {
        valid: false,
        error: platformRestrictionMessage(coupon.validPlatforms),
      };
    }

    // 4. Check maxUses (usedCount < maxUses or null)
    if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
      return { valid: false, error: "This coupon has reached its usage limit" };
    }

    // 5. If userId: check per-user usage < maxUsesPerUser
    if (context.userId) {
      const userUsageCount = await db.couponUsage.count({
        where: {
          couponId: coupon.id,
          userId: context.userId,
        },
      });
      if (userUsageCount >= coupon.maxUsesPerUser) {
        return { valid: false, error: "You have already used this coupon the maximum number of times" };
      }
    }

    // 6. Check sportFilter (if non-empty, context.sport must be in array)
    if (coupon.sportFilter.length > 0) {
      if (!context.sport || !coupon.sportFilter.includes(context.sport as never)) {
        return { valid: false, error: "This coupon is not valid for this sport" };
      }
    }

    // 6b. Sub-category exclusion — Coupon.categoryExclude lists
    // BookingCategory values that the coupon explicitly does NOT
    // apply to (the only one in use today is BOWLING_MACHINE for
    // the new-user welcome discount). An empty array means the
    // coupon applies to every sub-category.
    if (
      coupon.categoryExclude.length > 0 &&
      context.bookingCategory &&
      coupon.categoryExclude.includes(context.bookingCategory as never)
    ) {
      return {
        valid: false,
        error: "This coupon is not valid for bowling machine bookings",
      };
    }

    // 7. Check categoryFilter (if non-empty, context.categories must intersect)
    if (coupon.categoryFilter.length > 0) {
      if (
        !context.categories ||
        !context.categories.some((cat) =>
          coupon.categoryFilter.includes(cat as never)
        )
      ) {
        return { valid: false, error: "This coupon is not valid for these items" };
      }
    }

    // 8. Eligibility — three independent paths, OR'd together. The
    //    coupon "has targeting" if any of:
    //      - eligibleUsers (admin pinned specific users)
    //      - eligibleGroups (admin pinned admin-curated cohorts)
    //      - userGroupFilter (auto-computed buckets like FIRST_TIME)
    //    are non-empty. When targeting is set the user must satisfy
    //    at least one path; otherwise anyone qualifies (subject to
    //    the other filters above).
    const eligibleUserIds = coupon.eligibleUsers.map((e) => e.userId);
    const eligibleGroupIds = coupon.eligibleGroups.map((e) => e.groupId);
    const hasTargeting =
      eligibleUserIds.length > 0 ||
      eligibleGroupIds.length > 0 ||
      coupon.userGroupFilter.length > 0;

    if (hasTargeting) {
      if (!context.userId) {
        return { valid: false, error: "You must be logged in to use this coupon" };
      }

      let matchesEligibility = false;

      // Path A: direct user assignment (cheapest — already loaded).
      if (eligibleUserIds.includes(context.userId)) {
        matchesEligibility = true;
      }

      // Path B: admin-curated group membership.
      if (!matchesEligibility && eligibleGroupIds.length > 0) {
        const memberHit = await db.userGroupMember.findFirst({
          where: {
            userId: context.userId,
            groupId: { in: eligibleGroupIds },
            // Skip soft-deleted groups so removing a group from
            // the admin tab doesn't accidentally keep it acting as
            // a wildcard for its former members.
            group: { deletedAt: null },
          },
          select: { id: true },
        });
        if (memberHit) matchesEligibility = true;
      }

      // Path C: auto-computed UserGroupType bucket. Only reached if
      // the cheaper paths above didn't already match — saves the
      // booking-count queries for the common case where the user
      // was directly invited.
      if (!matchesEligibility && coupon.userGroupFilter.length > 0) {
        const user = await db.user.findUnique({
          where: { id: context.userId },
          select: { birthday: true },
        });

        for (const group of coupon.userGroupFilter) {
          switch (group) {
            case "FIRST_TIME": {
              // Only count bookings / orders the user made themselves
              // (createdByAdminId === null). An admin pre-booking a
              // slot for a fresh customer shouldn't burn that
              // customer's first-time eligibility — when they sign in
              // and book online the first time, that's still their
              // first *own* booking. PREMIUM_PLAYER / FREQUENT_VISITOR
              // below intentionally don't add this filter: those
              // reward venue patronage, and physical patronage is the
              // same regardless of who pressed the booking button.
              const [bookingCount, orderCount] = await Promise.all([
                db.booking.count({
                  where: {
                    userId: context.userId,
                    status: "CONFIRMED",
                    createdByAdminId: null,
                  },
                }),
                db.cafeOrder.count({
                  where: {
                    userId: context.userId,
                    status: "COMPLETED",
                    createdByAdminId: null,
                  },
                }),
              ]);
              if (bookingCount === 0 && orderCount === 0) matchesEligibility = true;
              break;
            }
            case "PREMIUM_PLAYER": {
              const confirmedBookings = await db.booking.count({
                where: { userId: context.userId, status: "CONFIRMED" },
              });
              if (confirmedBookings >= 10) matchesEligibility = true;
              break;
            }
            case "FREQUENT_VISITOR": {
              const completedOrders = await db.cafeOrder.count({
                where: { userId: context.userId, status: "COMPLETED" },
              });
              if (completedOrders >= 5) matchesEligibility = true;
              break;
            }
            case "BIRTHDAY_MONTH": {
              if (user?.birthday) {
                const birthMonth = user.birthday.getMonth();
                const currentMonth = now.getMonth();
                if (birthMonth === currentMonth) matchesEligibility = true;
              }
              break;
            }
            case "CUSTOM":
              // CUSTOM is the legacy "anyone the admin chose" bucket;
              // the new eligibleUsers/eligibleGroups relations replace
              // it for new coupons. Kept as a permissive pass-through
              // so coupons created before this feature still work.
              matchesEligibility = true;
              break;
          }
          if (matchesEligibility) break;
        }
      }

      if (!matchesEligibility) {
        return { valid: false, error: "You are not eligible for this coupon" };
      }
    }

    // 9. Check conditions (CouponCondition[])
    for (const condition of coupon.conditions) {
      const condValue = JSON.parse(condition.conditionValue);

      switch (condition.conditionType) {
        case "MIN_AMOUNT": {
          // Both `context.amount` (= hold.totalAmount) and the
          // stored `minAmount` are whole rupees post Phase 9 unit
          // unification. No paise conversion anywhere on the path.
          const minAmount = condValue.minAmount as number;
          if (context.amount < minAmount) {
            return {
              valid: false,
              error: `Minimum order amount is ₹${minAmount.toLocaleString("en-IN")}`,
            };
          }
          break;
        }
        case "TIME_WINDOW": {
          const { startHour, endHour } = condValue as {
            startHour: number;
            endHour: number;
          };
          const currentHour = now.getHours();
          if (startHour <= endHour) {
            if (currentHour < startHour || currentHour >= endHour) {
              return {
                valid: false,
                error: `This coupon is only valid between ${startHour}:00 and ${endHour}:00`,
              };
            }
          } else {
            // Wraps midnight, e.g., 22-06
            if (currentHour < startHour && currentHour >= endHour) {
              return {
                valid: false,
                error: `This coupon is only valid between ${startHour}:00 and ${endHour}:00`,
              };
            }
          }
          break;
        }
        case "BOOKING_DATE": {
          // {"from":"YYYY-MM-DD","to":"YYYY-MM-DD"} — IST calendar days,
          // inclusive. Compared against the booking's PLAY date (not the
          // purchase time — validFrom/validUntil already cover that).
          const { from, to } = condValue as { from?: string; to?: string };
          const label =
            from === to || !to ? `on ${from}` : `between ${from} and ${to}`;
          if (!context.bookingDate) {
            return {
              valid: false,
              error: `This coupon is only valid for bookings ${label}`,
            };
          }
          const playDay = context.bookingDate.toLocaleDateString("en-CA", {
            timeZone: "Asia/Kolkata",
          });
          if ((from && playDay < from) || (to && playDay > to)) {
            return {
              valid: false,
              error: `This coupon is only valid for bookings ${label}`,
            };
          }
          break;
        }
        case "FIRST_PURCHASE": {
          if (!context.userId) {
            return { valid: false, error: "You must be logged in to use this coupon" };
          }
          const priorUsage = await db.couponUsage.count({
            where: { userId: context.userId },
          });
          if (priorUsage > 0) {
            return { valid: false, error: "This coupon is only valid for first-time purchases" };
          }
          break;
        }
        case "FIRST_APP_BOOKING": {
          if (!context.userId) {
            return { valid: false, error: "You must be logged in to use this coupon" };
          }
          // A "first app booking" can only happen ON the app — reject on web.
          if (context.platform !== "android" && context.platform !== "ios") {
            return {
              valid: false,
              error: "This coupon is only valid on your first app booking",
            };
          }
          // Disqualify if the user already made a real booking via the app.
          // Cancelled bookings don't count; admin-created bookings don't burn
          // eligibility; web bookings don't count (so a long-time web user can
          // still claim their first APP booking — the point is app adoption).
          const priorAppBookings = await db.booking.count({
            where: {
              userId: context.userId,
              platform: { in: ["android", "ios"] },
              status: { in: ["CONFIRMED", "COMPLETED", "ABSENT"] },
              createdByAdminId: null,
            },
          });
          if (priorAppBookings > 0) {
            return {
              valid: false,
              error: "This coupon is only valid on your first app booking",
            };
          }
          break;
        }
        // Additional condition types handled at filter level (SPORT_SPECIFIC,
        // CATEGORY_SPECIFIC, USER_GROUP, BIRTHDAY, REFERRAL) are already
        // covered by sportFilter, categoryFilter, and userGroupFilter above.
        default:
          break;
      }
    }

    // Check minAmount on coupon itself. Both sides are whole rupees.
    if (coupon.minAmount !== null && context.amount < coupon.minAmount) {
      return {
        valid: false,
        error: `Minimum amount is ₹${coupon.minAmount.toLocaleString("en-IN")}`,
      };
    }

    // 10. Calculate discount. `context.amount`, `value` (FLAT and
    // TARGET_PRICE) and `maxDiscount` are all in RUPEES here —
    // PERCENTAGE `value` is basis points. (The schema comment says "paise" but the web admin, this
    // validator, and auto-apply-promo all treat FLAT value/maxDiscount as
    // whole rupees; that's the canonical unit across existing coupon data.)
    let discountAmount: number;
    if (coupon.type === "PERCENTAGE") {
      discountAmount = Math.floor((context.amount * coupon.value) / 10000);
      if (coupon.maxDiscount !== null) {
        discountAmount = Math.min(discountAmount, coupon.maxDiscount);
      }
    } else if (coupon.type === "TARGET_PRICE") {
      // "One price, all day": `value` is the target price PER SLOT, so
      // the saving is the sum of what each slot is over it. Floored per
      // slot rather than on the sum, so a slot already cheaper than the
      // target does not subsidise a dearer one — a ₹1500 target on a
      // mixed ₹2000 + ₹1000 booking saves ₹500, not ₹0.
      const prices = await payableSlotPrices(context);
      if (prices.length === 0) {
        // See `holdId` above for why this is a refusal and not a
        // fallback to the whole-amount formula.
        return {
          valid: false,
          error: "This offer applies to court bookings only",
        };
      }
      discountAmount = prices.reduce(
        (sum, price) => sum + Math.max(0, price - coupon.value),
        0,
      );
      if (coupon.maxDiscount !== null) {
        discountAmount = Math.min(discountAmount, coupon.maxDiscount);
      }
    } else {
      // FLAT
      discountAmount = coupon.value;
    }

    // Cap at total amount
    discountAmount = Math.min(discountAmount, context.amount);

    return {
      valid: true,
      discountAmount,
      couponId: coupon.id,
    };
  } catch (error) {
    console.error("Coupon validation error:", error);
    return { valid: false, error: "Failed to validate coupon" };
  }
}

export async function applyCoupon(
  couponId: string,
  userId: string,
  context: {
    bookingId?: string;
    cafeOrderId?: string;
    discountAmount: number;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await db.$transaction(
      async (tx) => {
        // Re-validate the coupon inside the transaction
        const coupon = await tx.coupon.findUnique({
          where: { id: couponId },
        });

        if (!coupon || !coupon.isActive) {
          throw new Error("Coupon is no longer active");
        }

        const now = new Date();
        if (now < coupon.validFrom || now > coupon.validUntil) {
          throw new Error("Coupon has expired");
        }

        if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
          throw new Error("Coupon usage limit reached");
        }

        const userUsageCount = await tx.couponUsage.count({
          where: { couponId: coupon.id, userId },
        });
        if (userUsageCount >= coupon.maxUsesPerUser) {
          throw new Error("Per-user usage limit reached");
        }

        // Increment usedCount
        await tx.coupon.update({
          where: { id: couponId },
          data: { usedCount: { increment: 1 } },
        });

        // Create CouponUsage record
        await tx.couponUsage.create({
          data: {
            couponId,
            userId,
            bookingId: context.bookingId || null,
            cafeOrderId: context.cafeOrderId || null,
            discountAmount: context.discountAmount,
          },
        });

        return { success: true };
      },
      // RepeatableRead prevents the phantom reads we care about (seeing a
      // stale usedCount) without the serialization-failure retries that
      // Serializable triggers under concurrent coupon redemption.
      { isolationLevel: "RepeatableRead", timeout: 10000 }
    );

    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to apply coupon",
    };
  }
}
