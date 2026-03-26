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
    },
    include: { conditions: true },
    orderBy: { createdAt: "desc" },
  });

  return coupons.map(formatCouponForPublic);
}

export async function getPersonalizedCoupons(): Promise<{
  birthdayCoupons: PublicCoupon[];
  firstTimeCoupons: PublicCoupon[];
  groupCoupons: PublicCoupon[];
}> {
  const session = await auth();
  if (!session?.user?.id) {
    return { birthdayCoupons: [], firstTimeCoupons: [], groupCoupons: [] };
  }

  const userId = session.user.id;
  const now = new Date();

  // Fetch user info
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { birthday: true },
  });

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

  // Check user stats
  const [confirmedBookings, completedOrders, totalCouponUsages] =
    await Promise.all([
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
  const isFirstTime = confirmedBookings === 0 && completedOrders === 0;
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

  return { birthdayCoupons, firstTimeCoupons, groupCoupons };
}
