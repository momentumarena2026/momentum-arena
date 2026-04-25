"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { CouponScope, Coupon, CouponCondition } from "@prisma/client";

type CouponWithConditions = Coupon & { conditions: CouponCondition[] };

interface PublicCoupon {
  id: string;
  code: string;
  description: string | null;
  scope: CouponScope;
  type: string;
  value: number;
  maxDiscount: number | null;
  minAmount: number | null;
  sportFilter: string[];
  categoryFilter: string[];
  validFrom: string;
  validUntil: string;
  conditions: { type: string; value: string }[];
}

function formatCouponForPublic(coupon: CouponWithConditions): PublicCoupon {
  return {
    id: coupon.id,
    code: coupon.code,
    description: coupon.description,
    scope: coupon.scope,
    type: coupon.type,
    value: coupon.value,
    maxDiscount: coupon.maxDiscount,
    minAmount: coupon.minAmount,
    sportFilter: coupon.sportFilter,
    categoryFilter: coupon.categoryFilter,
    validFrom: coupon.validFrom.toISOString(),
    validUntil: coupon.validUntil.toISOString(),
    conditions: coupon.conditions.map((c) => ({
      type: c.conditionType,
      value: c.conditionValue,
    })),
  };
}

export async function getAvailableCoupons(
  scope: "SPORTS" | "CAFE" | "BOTH"
): Promise<PublicCoupon[]> {
  const now = new Date();

  // Fetch all public, active coupons that are currently valid
  const scopeFilter: CouponScope[] =
    scope === "BOTH"
      ? ["SPORTS", "CAFE", "BOTH"]
      : [scope, "BOTH"];

  const coupons = await db.coupon.findMany({
    where: {
      isActive: true,
      isPublic: true,
      validFrom: { lte: now },
      validUntil: { gte: now },
      scope: { in: scopeFilter },
      // Hide admin-curated targeted coupons from the public list —
      // those are private to the listed users / group members and
      // surface only via getPersonalizedCoupons. Auto buckets
      // (`userGroupFilter` like FIRST_TIME) stay public; the user
      // can see them and either qualify by behaviour or get a
      // friendly "not eligible" at redemption.
      eligibleUsers: { none: {} },
      eligibleGroups: { none: {} },
    },
    include: { conditions: true },
    orderBy: { createdAt: "desc" },
  });

  return coupons.map(formatCouponForPublic);
}

export interface PersonalizedCouponsResult {
  birthdayCoupons: PublicCoupon[];
  firstTimeCoupons: PublicCoupon[];
  groupCoupons: PublicCoupon[];
  /**
   * Coupons admin-targeted directly at this user (or at a group the
   * user belongs to). These never appear in `getAvailableCoupons`
   * — the public list intentionally hides them so non-targeted
   * users don't see a private offer.
   */
  targetedCoupons: PublicCoupon[];
}

const EMPTY_PERSONALIZED: PersonalizedCouponsResult = {
  birthdayCoupons: [],
  firstTimeCoupons: [],
  groupCoupons: [],
  targetedCoupons: [],
};

/**
 * Web entry point — uses the NextAuth session. Mobile callers should
 * use `getPersonalizedCouponsForUser` directly with the userId
 * resolved via `getMobileUser` (NextAuth doesn't recognise the
 * mobile JWT).
 */
export async function getPersonalizedCoupons(): Promise<PersonalizedCouponsResult> {
  const session = await auth();
  if (!session?.user?.id) return EMPTY_PERSONALIZED;
  return getPersonalizedCouponsForUser(session.user.id);
}

export async function getPersonalizedCouponsForUser(
  userId: string,
): Promise<PersonalizedCouponsResult> {
  const now = new Date();

  // Fetch user info
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { birthday: true },
  });

  // Resolve which admin groups this user belongs to. Used by the
  // targeted-coupon query below — the coupon can target the user
  // directly OR target any group they're a member of, both count.
  // We exclude soft-deleted groups so removing a group from the
  // admin tab stops surfacing the coupon to ex-members.
  const memberships = await db.userGroupMember.findMany({
    where: { userId, group: { deletedAt: null } },
    select: { groupId: true },
  });
  const userGroupIds = memberships.map((m) => m.groupId);

  // Get all active, valid coupons with user group filters
  const coupons = await db.coupon.findMany({
    where: {
      isActive: true,
      validFrom: { lte: now },
      validUntil: { gte: now },
      userGroupFilter: { isEmpty: false },
    },
    include: { conditions: true },
  });

  // Check user stats. Two separate pairs of counts on purpose:
  //
  //   - `selfConfirmedBookings` / `selfCompletedOrders` — bookings the
  //     user actually made themselves (createdByAdminId IS NULL).
  //     Drives FIRST_TIME, where the question is "has this user ever
  //     booked online for themselves yet?". An admin pre-booking on
  //     behalf of a brand-new customer must NOT burn that customer's
  //     first-time eligibility — when the customer signs in and books
  //     online the first time, that's still their first own booking.
  //
  //   - `confirmedBookings` / `completedOrders` — every booking /
  //     order regardless of creator. Drives PREMIUM_PLAYER and
  //     FREQUENT_VISITOR, which reward physical venue patronage —
  //     and the user genuinely has played here ten times even if
  //     admin pressed the booking button.
  const [
    selfConfirmedBookings,
    selfCompletedOrders,
    confirmedBookings,
    completedOrders,
    totalCouponUsages,
  ] = await Promise.all([
    db.booking.count({
      where: { userId, status: "CONFIRMED", createdByAdminId: null },
    }),
    db.cafeOrder.count({
      where: { userId, status: "COMPLETED", createdByAdminId: null },
    }),
    db.booking.count({
      where: { userId, status: "CONFIRMED" },
    }),
    db.cafeOrder.count({
      where: { userId, status: "COMPLETED" },
    }),
    db.couponUsage.count({
      where: { userId },
    }),
  ]);

  const isBirthdayMonth =
    user?.birthday && user.birthday.getMonth() === now.getMonth();
  const isFirstTime =
    selfConfirmedBookings === 0 && selfCompletedOrders === 0;
  const isPremiumPlayer = confirmedBookings >= 10;
  const isFrequentVisitor = completedOrders >= 5;

  const birthdayCoupons: PublicCoupon[] = [];
  const firstTimeCoupons: PublicCoupon[] = [];
  const groupCoupons: PublicCoupon[] = [];

  for (const coupon of coupons) {
    // Check per-user usage
    const userUsageCount = await db.couponUsage.count({
      where: { couponId: coupon.id, userId },
    });
    if (userUsageCount >= coupon.maxUsesPerUser) continue;

    // Check global usage
    if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) continue;

    let eligible = false;

    for (const group of coupon.userGroupFilter) {
      switch (group) {
        case "BIRTHDAY_MONTH":
          if (isBirthdayMonth) {
            birthdayCoupons.push(formatCouponForPublic(coupon));
            eligible = true;
          }
          break;
        case "FIRST_TIME":
          if (isFirstTime) {
            firstTimeCoupons.push(formatCouponForPublic(coupon));
            eligible = true;
          }
          break;
        case "PREMIUM_PLAYER":
          if (isPremiumPlayer) {
            groupCoupons.push(formatCouponForPublic(coupon));
            eligible = true;
          }
          break;
        case "FREQUENT_VISITOR":
          if (isFrequentVisitor) {
            groupCoupons.push(formatCouponForPublic(coupon));
            eligible = true;
          }
          break;
        case "CUSTOM":
          groupCoupons.push(formatCouponForPublic(coupon));
          eligible = true;
          break;
      }
      if (eligible) break;
    }
  }

  // Admin-targeted coupons: directly assigned to this user OR
  // assigned to a group they're a member of. Single query — Prisma
  // OR's the two relation filters at the SQL level.
  const targetedCouponsRaw = await db.coupon.findMany({
    where: {
      isActive: true,
      validFrom: { lte: now },
      validUntil: { gte: now },
      OR: [
        { eligibleUsers: { some: { userId } } },
        ...(userGroupIds.length > 0
          ? [{ eligibleGroups: { some: { groupId: { in: userGroupIds } } } }]
          : []),
      ],
    },
    include: { conditions: true },
    orderBy: { createdAt: "desc" },
  });

  const targetedCoupons: PublicCoupon[] = [];
  for (const coupon of targetedCouponsRaw) {
    // Same per-user / global usage gates as the auto buckets above —
    // a targeted coupon that's already been redeemed shouldn't be
    // dangled in front of the user as still-available.
    const userUsageCount = await db.couponUsage.count({
      where: { couponId: coupon.id, userId },
    });
    if (userUsageCount >= coupon.maxUsesPerUser) continue;
    if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) continue;
    targetedCoupons.push(formatCouponForPublic(coupon));
  }

  return { birthdayCoupons, firstTimeCoupons, groupCoupons, targetedCoupons };
}
