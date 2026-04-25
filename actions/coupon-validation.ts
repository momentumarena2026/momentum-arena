"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { CouponScope } from "@prisma/client";

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
              const [bookingCount, orderCount] = await Promise.all([
                db.booking.count({
                  where: { userId: context.userId, status: "CONFIRMED" },
                }),
                db.cafeOrder.count({
                  where: { userId: context.userId, status: "COMPLETED" },
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
          const minAmount = condValue.minAmount as number;
          if (context.amount < minAmount) {
            return {
              valid: false,
              error: `Minimum order amount is ₹${(minAmount / 100).toLocaleString("en-IN")}`,
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
        // Additional condition types handled at filter level (SPORT_SPECIFIC,
        // CATEGORY_SPECIFIC, USER_GROUP, BIRTHDAY, REFERRAL) are already
        // covered by sportFilter, categoryFilter, and userGroupFilter above.
        default:
          break;
      }
    }

    // Check minAmount on coupon itself
    if (coupon.minAmount !== null && context.amount < coupon.minAmount) {
      return {
        valid: false,
        error: `Minimum amount is ₹${(coupon.minAmount / 100).toLocaleString("en-IN")}`,
      };
    }

    // 10. Calculate discount
    let discountAmount: number;
    if (coupon.type === "PERCENTAGE") {
      discountAmount = Math.floor((context.amount * coupon.value) / 10000);
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
