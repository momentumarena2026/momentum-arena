"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import {
  CouponScope,
  CouponConditionType,
  DiscountType,
  Sport,
  CafeItemCategory,
  UserGroupType,
  BookingCategory,
  Prisma,
} from "@prisma/client";
import { requireAdmin as requireAdminBase } from "@/lib/admin-auth";
import {
  listAdminBookingCoupons,
  type AdminCouponOption,
} from "@/lib/admin-coupon-options";

async function requireAdmin() {
  // MANAGE_COUPONS — matches the admin sidebar gate for /admin/coupons (was
  // MANAGE_DISCOUNTS, which the sidebar never grants here → see-but-can't-use).
  const user = await requireAdminBase("MANAGE_COUPONS");
  return user.id;
}

const conditionSchema = z.object({
  conditionType: z.enum([
    "MIN_AMOUNT",
    "FIRST_PURCHASE",
    "USER_GROUP",
    "SPORT_SPECIFIC",
    "CATEGORY_SPECIFIC",
    "TIME_WINDOW",
    "BIRTHDAY",
    "REFERRAL",
    "FIRST_APP_BOOKING",
    "BOOKING_DATE",
  ]),
  conditionValue: z.string(), // JSON string
});

const couponSchema = z.object({
  code: z.string().min(3).max(30),
  description: z.string().optional(),
  scope: z.enum(["SPORTS", "CAFE", "BOTH"]),
  type: z.enum(["PERCENTAGE", "FLAT"]),
  value: z.number().int().min(1),
  maxDiscount: z.number().int().min(0).nullable().optional(),
  maxUses: z.number().int().min(1).nullable().optional(),
  maxUsesPerUser: z.number().int().min(1).default(1),
  minAmount: z.number().int().min(0).nullable().optional(),
  sportFilter: z
    .array(z.enum(["CRICKET", "FOOTBALL", "PICKLEBALL"]))
    .default([]),
  categoryFilter: z
    .array(z.enum(["SNACKS", "BEVERAGES", "MEALS", "DESSERTS", "COMBOS"]))
    .default([]),
  // Sport sub-category exclusions — currently only CRICKET has
  // sub-categories (BOX_CRICKET / BOWLING_MACHINE). Empty array =
  // coupon applies to every sub-flow of the matched sport(s).
  categoryExclude: z
    .array(z.enum(["BOX_CRICKET", "BOWLING_MACHINE"]))
    .default([]),
  userGroupFilter: z
    .array(
      z.enum([
        "FIRST_TIME",
        "PREMIUM_PLAYER",
        "FREQUENT_VISITOR",
        "BIRTHDAY_MONTH",
        "CUSTOM",
      ])
    )
    .default([]),
  // Platform restriction. Empty = all platforms. Values mirror
  // Booking.platform; "App-only" = ["android","ios"].
  validPlatforms: z
    .array(z.enum(["web", "android", "ios"]))
    .default([]),
  isStackable: z.boolean().default(false),
  stackGroup: z.string().nullable().optional(),
  isPublic: z.boolean().default(true),
  isSystemCode: z.boolean().default(false),
  // Checkout tries autoApply coupons FIRST (before new-user/fallback).
  autoApply: z.boolean().default(false),
  // Advertise this coupon's effective price on the slot-selection page
  // (struck-through slot prices + launch banner). Only honoured when
  // autoApply is also on.
  showStrikethrough: z.boolean().default(false),
  validFrom: z.string().min(1),
  validUntil: z.string().min(1),
  conditions: z.array(conditionSchema).default([]),
  // Admin-curated targeting. Both empty → no targeting (anyone can
  // use, subject to other filters). Otherwise the user must appear
  // in `eligibleUserIds` OR be a member of one of `eligibleGroupIds`
  // (OR'd with userGroupFilter — see coupon-validation.ts).
  eligibleUserIds: z.array(z.string()).default([]),
  eligibleGroupIds: z.array(z.string()).default([]),
});

export async function getCoupons(filters?: {
  scope?: CouponScope;
  isActive?: boolean;
  search?: string;
}) {
  await requireAdmin();

  const where: Record<string, unknown> = {};

  if (filters?.scope) {
    where.scope = filters.scope;
  }
  if (filters?.isActive !== undefined) {
    where.isActive = filters.isActive;
  }
  if (filters?.search) {
    where.OR = [
      { code: { contains: filters.search, mode: "insensitive" } },
      { description: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  const coupons = await db.coupon.findMany({
    where,
    include: {
      conditions: true,
      eligibleUsers: {
        include: {
          user: {
            select: { id: true, name: true, email: true, phone: true },
          },
        },
      },
      eligibleGroups: {
        include: {
          group: {
            select: { id: true, name: true, deletedAt: true },
          },
        },
      },
      _count: { select: { usages: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return coupons;
}

export async function createCoupon(data: {
  code: string;
  description?: string;
  scope: CouponScope;
  type: DiscountType;
  value: number;
  maxDiscount?: number | null;
  maxUses?: number | null;
  maxUsesPerUser?: number;
  minAmount?: number | null;
  sportFilter?: Sport[];
  categoryFilter?: CafeItemCategory[];
  categoryExclude?: BookingCategory[];
  userGroupFilter?: UserGroupType[];
  validPlatforms?: ("web" | "android" | "ios")[];
  isStackable?: boolean;
  stackGroup?: string | null;
  isPublic?: boolean;
  isSystemCode?: boolean;
  autoApply?: boolean;
  validFrom: string;
  validUntil: string;
  conditions?: { conditionType: CouponConditionType; conditionValue: string }[];
  eligibleUserIds?: string[];
  eligibleGroupIds?: string[];
}) {
  const adminId = await requireAdmin();

  const parsed = couponSchema.safeParse(data);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Invalid data",
    };
  }

  const code = parsed.data.code.toUpperCase().trim();

  // Check uniqueness
  const existing = await db.coupon.findUnique({ where: { code } });
  if (existing) return { success: false, error: "Coupon code already exists" };

  // Validate percentage <= 10000 basis points (100%)
  if (parsed.data.type === "PERCENTAGE" && parsed.data.value > 10000) {
    return { success: false, error: "Percentage cannot exceed 100%" };
  }

  // Dedupe targeting lists — admin pickers should already prevent
  // duplicates but the unique index would reject them anyway, and
  // skipping the round-trip is cheaper.
  const eligibleUserIds = Array.from(new Set(parsed.data.eligibleUserIds));
  const eligibleGroupIds = Array.from(new Set(parsed.data.eligibleGroupIds));

  try {
    await db.coupon.create({
      data: {
        code,
        description: parsed.data.description || null,
        scope: parsed.data.scope,
        type: parsed.data.type,
        value: parsed.data.value,
        maxDiscount: parsed.data.maxDiscount ?? null,
        maxUses: parsed.data.maxUses ?? null,
        maxUsesPerUser: parsed.data.maxUsesPerUser,
        minAmount: parsed.data.minAmount ?? null,
        sportFilter: parsed.data.sportFilter,
        categoryFilter: parsed.data.categoryFilter,
        categoryExclude: parsed.data.categoryExclude,
        userGroupFilter: parsed.data.userGroupFilter,
        validPlatforms: parsed.data.validPlatforms,
        isStackable: parsed.data.isStackable,
        stackGroup: parsed.data.stackGroup ?? null,
        isPublic: parsed.data.isPublic,
        isSystemCode: parsed.data.isSystemCode,
        autoApply: parsed.data.autoApply,
        showStrikethrough: parsed.data.showStrikethrough && parsed.data.autoApply,
        validFrom: new Date(parsed.data.validFrom),
        validUntil: new Date(parsed.data.validUntil),
        createdBy: adminId,
        conditions: {
          create: parsed.data.conditions.map((c) => ({
            conditionType: c.conditionType,
            conditionValue: c.conditionValue,
          })),
        },
        ...(eligibleUserIds.length
          ? {
              eligibleUsers: {
                createMany: {
                  data: eligibleUserIds.map((userId) => ({ userId })),
                  skipDuplicates: true,
                },
              },
            }
          : {}),
        ...(eligibleGroupIds.length
          ? {
              eligibleGroups: {
                createMany: {
                  data: eligibleGroupIds.map((groupId) => ({ groupId })),
                  skipDuplicates: true,
                },
              },
            }
          : {}),
      },
    });

    return { success: true };
  } catch (error) {
    console.error("Failed to create coupon:", error);
    return { success: false, error: "Failed to create coupon" };
  }
}

export async function updateCoupon(
  id: string,
  data: {
    description?: string;
    scope?: CouponScope;
    type?: DiscountType;
    value?: number;
    maxDiscount?: number | null;
    maxUses?: number | null;
    maxUsesPerUser?: number;
    minAmount?: number | null;
    sportFilter?: Sport[];
    categoryFilter?: CafeItemCategory[];
    categoryExclude?: BookingCategory[];
    userGroupFilter?: UserGroupType[];
    validPlatforms?: ("web" | "android" | "ios")[];
    isStackable?: boolean;
    stackGroup?: string | null;
    isPublic?: boolean;
    isSystemCode?: boolean;
    autoApply?: boolean;
    showStrikethrough?: boolean;
    validFrom?: string;
    validUntil?: string;
    isActive?: boolean;
    conditions?: { conditionType: CouponConditionType; conditionValue: string }[];
    eligibleUserIds?: string[];
    eligibleGroupIds?: string[];
  }
) {
  await requireAdmin();

  try {
    const updateData: Record<string, unknown> = {};

    if (data.description !== undefined) updateData.description = data.description;
    if (data.scope !== undefined) updateData.scope = data.scope;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.value !== undefined) updateData.value = data.value;
    if (data.maxDiscount !== undefined) updateData.maxDiscount = data.maxDiscount;
    if (data.maxUses !== undefined) updateData.maxUses = data.maxUses;
    if (data.maxUsesPerUser !== undefined) updateData.maxUsesPerUser = data.maxUsesPerUser;
    if (data.minAmount !== undefined) updateData.minAmount = data.minAmount;
    if (data.sportFilter !== undefined) updateData.sportFilter = data.sportFilter;
    if (data.categoryFilter !== undefined) updateData.categoryFilter = data.categoryFilter;
    if (data.categoryExclude !== undefined) updateData.categoryExclude = data.categoryExclude;
    if (data.userGroupFilter !== undefined) updateData.userGroupFilter = data.userGroupFilter;
    if (data.validPlatforms !== undefined) updateData.validPlatforms = data.validPlatforms;
    if (data.isStackable !== undefined) updateData.isStackable = data.isStackable;
    if (data.stackGroup !== undefined) updateData.stackGroup = data.stackGroup;
    if (data.isPublic !== undefined) updateData.isPublic = data.isPublic;
    if (data.isSystemCode !== undefined) updateData.isSystemCode = data.isSystemCode;
    if (data.autoApply !== undefined) updateData.autoApply = data.autoApply;
    if (data.showStrikethrough !== undefined) {
      updateData.showStrikethrough = data.showStrikethrough;
    }
    // Never leave strikethrough advertised on a coupon checkout won't
    // auto-apply.
    if (data.autoApply === false) updateData.showStrikethrough = false;
    if (data.validFrom !== undefined) updateData.validFrom = new Date(data.validFrom);
    if (data.validUntil !== undefined) updateData.validUntil = new Date(data.validUntil);
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    // Conditions and the two eligibility lists are all "replace
    // wholesale when provided" semantics — we don't try to diff
    // adds/removes from the client, the form ships the final state
    // and the server reconciles. Wrapped in a single transaction so
    // a coupon never sees a half-updated targeting state mid-edit.
    const tx: Prisma.PrismaPromise<unknown>[] = [];

    if (data.conditions !== undefined) {
      tx.push(
        db.couponCondition.deleteMany({ where: { couponId: id } }),
        db.coupon.update({
          where: { id },
          data: {
            ...updateData,
            conditions: {
              create: data.conditions.map((c) => ({
                conditionType: c.conditionType,
                conditionValue: c.conditionValue,
              })),
            },
          },
        }),
      );
    } else if (Object.keys(updateData).length > 0) {
      tx.push(db.coupon.update({ where: { id }, data: updateData }));
    }

    if (data.eligibleUserIds !== undefined) {
      const ids = Array.from(new Set(data.eligibleUserIds));
      tx.push(db.couponEligibleUser.deleteMany({ where: { couponId: id } }));
      if (ids.length > 0) {
        tx.push(
          db.couponEligibleUser.createMany({
            data: ids.map((userId) => ({ couponId: id, userId })),
            skipDuplicates: true,
          }),
        );
      }
    }

    if (data.eligibleGroupIds !== undefined) {
      const ids = Array.from(new Set(data.eligibleGroupIds));
      tx.push(db.couponEligibleGroup.deleteMany({ where: { couponId: id } }));
      if (ids.length > 0) {
        tx.push(
          db.couponEligibleGroup.createMany({
            data: ids.map((groupId) => ({ couponId: id, groupId })),
            skipDuplicates: true,
          }),
        );
      }
    }

    if (tx.length > 0) {
      await db.$transaction(tx);
    }

    return { success: true };
  } catch (error) {
    console.error("Failed to update coupon:", error);
    return { success: false, error: "Failed to update coupon" };
  }
}

export async function deleteCoupon(id: string) {
  await requireAdmin();

  try {
    const coupon = await db.coupon.findUnique({ where: { id } });
    if (!coupon) return { success: false, error: "Coupon not found" };

    await db.coupon.update({
      where: { id },
      data: { isActive: false },
    });

    return { success: true };
  } catch (error) {
    console.error("Failed to delete coupon:", error);
    return { success: false, error: "Failed to delete coupon" };
  }
}

export async function getCouponUsageDetails(couponId: string) {
  await requireAdmin();

  try {
    const usages = await db.couponUsage.findMany({
      where: { couponId },
      orderBy: { createdAt: "desc" },
      include: {
        coupon: { select: { code: true } },
      },
    });

    // Fetch user info separately since CouponUsage doesn't have a direct relation
    const userIds = [...new Set(usages.map((u) => u.userId))];
    const users = await db.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true, phone: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    return usages.map((usage) => ({
      id: usage.id,
      userId: usage.userId,
      userName: userMap.get(usage.userId)?.name || "Unknown",
      userEmail: userMap.get(usage.userId)?.email || null,
      userPhone: userMap.get(usage.userId)?.phone || null,
      bookingId: usage.bookingId,
      cafeOrderId: usage.cafeOrderId,
      discountAmount: usage.discountAmount,
      createdAt: usage.createdAt.toISOString(),
    }));
  } catch (error) {
    console.error("Failed to get coupon usage:", error);
    return [];
  }
}

/**
 * Coupons an admin may apply while creating a booking for `sport`.
 *
 * The create-booking form used to expose a single hardcoded checkbox for
 * the auto-apply launch promo, so when that promo was swapped the admin
 * lost every way to honour a code a customer quotes at the counter. This
 * returns the live candidates instead; adminCreateBooking still re-runs
 * the full customer-side validator on whichever one is picked, so this
 * list is a convenience, never the authority.
 */
export async function listAdminSportCoupons(
  sport: string,
  category?: string | null
): Promise<AdminCouponOption[]> {
  // MANAGE_BOOKINGS, not MANAGE_COUPONS: this feeds the create-booking
  // form. Gating it on the coupons permission meant a desk admin who can
  // take a booking but doesn't administer coupons got a silent empty
  // picker — the throw is swallowed by the form's catch.
  await requireAdminBase("MANAGE_BOOKINGS");
  return listAdminBookingCoupons(sport, category);
}
