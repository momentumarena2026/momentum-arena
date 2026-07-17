import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { Prisma } from "@prisma/client";
import type {
  CouponScope,
  DiscountType,
  CouponConditionType,
} from "@prisma/client";

/**
 * Mobile admin coupon edit/disable — FULL parity with updateCoupon /
 * deleteCoupon in actions/admin-coupons.ts (MANAGE_COUPONS).
 *
 * Conditions and the two eligibility lists use "replace wholesale when
 * provided" semantics (same as the web action): the client ships the
 * final desired state and the server reconciles inside one transaction
 * so a coupon never sees a half-updated targeting state mid-edit.
 *
 * Units: PERCENTAGE value = basis points; FLAT value + maxDiscount =
 * whole RUPEES; minAmount = whole rupees. The client converts before
 * sending — do NOT re-scale here.
 */

const SPORTS = ["CRICKET", "FOOTBALL", "PICKLEBALL"] as const;
const CAFE_CATEGORIES = [
  "SNACKS",
  "BEVERAGES",
  "MEALS",
  "DESSERTS",
  "COMBOS",
] as const;
const BOOKING_CATEGORIES = ["BOX_CRICKET", "BOWLING_MACHINE"] as const;
const USER_GROUPS = [
  "FIRST_TIME",
  "PREMIUM_PLAYER",
  "FREQUENT_VISITOR",
  "BIRTHDAY_MONTH",
  "CUSTOM",
] as const;

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
  ]),
  conditionValue: z.string(),
});

const patchSchema = z.object({
  description: z.string().nullish(),
  scope: z.enum(["BOTH", "SPORTS", "CAFE"]).optional(),
  type: z.enum(["PERCENTAGE", "FLAT"]).optional(),
  value: z.number().int().positive().optional(),
  maxDiscount: z.number().int().min(0).nullish(),
  maxUses: z.number().int().positive().nullish(),
  maxUsesPerUser: z.number().int().min(1).optional(),
  minAmount: z.number().int().min(0).nullish(),
  sportFilter: z.array(z.enum(SPORTS)).optional(),
  categoryFilter: z.array(z.enum(CAFE_CATEGORIES)).optional(),
  categoryExclude: z.array(z.enum(BOOKING_CATEGORIES)).optional(),
  userGroupFilter: z.array(z.enum(USER_GROUPS)).optional(),
  validPlatforms: z.array(z.enum(["web", "android", "ios"])).optional(),
  isStackable: z.boolean().optional(),
  stackGroup: z.string().nullish(),
  isPublic: z.boolean().optional(),
  isSystemCode: z.boolean().optional(),
  autoApply: z.boolean().optional(),
  isActive: z.boolean().optional(),
  validFrom: z.string().min(1).optional(),
  validUntil: z.string().min(1).optional(),
  conditions: z.array(conditionSchema).optional(),
  eligibleUserIds: z.array(z.string()).optional(),
  eligibleGroupIds: z.array(z.string()).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileAdmin(request, "MANAGE_COUPONS");
  if ("error" in gate) return gate.error;
  const { id } = await params;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid data" },
      { status: 400 },
    );
  }
  const d = parsed.data;

  if (d.type === "PERCENTAGE" && d.value !== undefined && d.value > 10000) {
    return NextResponse.json(
      { error: "Percentage cannot exceed 100%" },
      { status: 400 },
    );
  }

  const data: Record<string, unknown> = {};
  if (d.description !== undefined) data.description = d.description?.trim() || null;
  if (d.scope !== undefined) data.scope = d.scope as CouponScope;
  if (d.type !== undefined) data.type = d.type as DiscountType;
  if (d.value !== undefined) data.value = d.value;
  if (d.maxDiscount !== undefined) data.maxDiscount = d.maxDiscount ?? null;
  if (d.maxUses !== undefined) data.maxUses = d.maxUses ?? null;
  if (d.maxUsesPerUser !== undefined) data.maxUsesPerUser = d.maxUsesPerUser;
  if (d.minAmount !== undefined) data.minAmount = d.minAmount ?? null;
  if (d.sportFilter !== undefined) data.sportFilter = d.sportFilter;
  if (d.categoryFilter !== undefined) data.categoryFilter = d.categoryFilter;
  if (d.categoryExclude !== undefined) data.categoryExclude = d.categoryExclude;
  if (d.userGroupFilter !== undefined) data.userGroupFilter = d.userGroupFilter;
  if (d.validPlatforms !== undefined) data.validPlatforms = d.validPlatforms;
  if (d.isStackable !== undefined) data.isStackable = d.isStackable;
  if (d.stackGroup !== undefined) data.stackGroup = d.stackGroup?.trim() || null;
  if (d.isPublic !== undefined) data.isPublic = d.isPublic;
  if (d.isSystemCode !== undefined) data.isSystemCode = d.isSystemCode;
  if (d.autoApply !== undefined) data.autoApply = d.autoApply;
  if (d.isActive !== undefined) data.isActive = d.isActive;
  if (d.validFrom !== undefined) data.validFrom = new Date(d.validFrom);
  if (d.validUntil !== undefined) data.validUntil = new Date(d.validUntil);

  const tx: Prisma.PrismaPromise<unknown>[] = [];

  if (d.conditions !== undefined) {
    tx.push(
      db.couponCondition.deleteMany({ where: { couponId: id } }),
      db.coupon.update({
        where: { id },
        data: {
          ...data,
          conditions: {
            create: d.conditions.map((c) => ({
              conditionType: c.conditionType as CouponConditionType,
              conditionValue: c.conditionValue,
            })),
          },
        },
      }),
    );
  } else if (Object.keys(data).length > 0) {
    tx.push(db.coupon.update({ where: { id }, data }));
  }

  if (d.eligibleUserIds !== undefined) {
    const ids = Array.from(new Set(d.eligibleUserIds));
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

  if (d.eligibleGroupIds !== undefined) {
    const ids = Array.from(new Set(d.eligibleGroupIds));
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

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileAdmin(request, "MANAGE_COUPONS");
  if ("error" in gate) return gate.error;
  const { id } = await params;
  await db.coupon.update({ where: { id }, data: { isActive: false } });
  return NextResponse.json({ ok: true });
}
