import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import type {
  CouponScope,
  DiscountType,
  CouponConditionType,
} from "@prisma/client";

/**
 * Mobile admin unified coupons — FULL parity with the web admin
 * (app/(admin)/admin/coupons + actions/admin-coupons.ts) under
 * MANAGE_COUPONS. Beyond the common create/edit fields this now wires:
 *   - targeting: eligibleUserIds / eligibleGroupIds (admin-curated)
 *   - conditions: MIN_AMOUNT / FIRST_PURCHASE / TIME_WINDOW (JSON value)
 *   - filters: sportFilter, categoryFilter, categoryExclude, userGroupFilter
 *   - stacking: isStackable + stackGroup
 *   - flags: isPublic, isSystemCode
 *
 * Units (match the Coupon model + web admin): PERCENTAGE value = basis
 * points (10% = 1000); FLAT value = whole RUPEES; maxDiscount = whole
 * RUPEES; minAmount = whole rupees. The mobile client converts ₹/%
 * inputs before sending — do NOT re-scale here.
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
  conditionValue: z.string(), // JSON string
});

const createSchema = z.object({
  code: z.string().min(3).max(30),
  description: z.string().optional(),
  scope: z.enum(["BOTH", "SPORTS", "CAFE"]),
  type: z.enum(["PERCENTAGE", "FLAT"]),
  value: z.number().int().positive(),
  maxDiscount: z.number().int().min(0).nullish(),
  maxUses: z.number().int().positive().nullish(),
  maxUsesPerUser: z.number().int().min(1).default(1),
  minAmount: z.number().int().min(0).nullish(),
  sportFilter: z.array(z.enum(SPORTS)).default([]),
  categoryFilter: z.array(z.enum(CAFE_CATEGORIES)).default([]),
  categoryExclude: z.array(z.enum(BOOKING_CATEGORIES)).default([]),
  userGroupFilter: z.array(z.enum(USER_GROUPS)).default([]),
  // Platform restriction. Empty = all platforms; "App-only" =
  // ["android","ios"]. Mirrors Coupon.validPlatforms / the web action.
  validPlatforms: z.array(z.enum(["web", "android", "ios"])).default([]),
  isStackable: z.boolean().default(false),
  stackGroup: z.string().nullish(),
  isPublic: z.boolean().default(true),
  isSystemCode: z.boolean().default(false),
  validFrom: z.string().min(1),
  validUntil: z.string().min(1),
  conditions: z.array(conditionSchema).default([]),
  eligibleUserIds: z.array(z.string()).default([]),
  eligibleGroupIds: z.array(z.string()).default([]),
});

export async function GET(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_COUPONS");
  if ("error" in gate) return gate.error;

  const showInactive =
    new URL(request.url).searchParams.get("showInactive") === "1";
  const where: Record<string, unknown> = {};
  if (!showInactive) where.isActive = true;

  const coupons = await db.coupon.findMany({
    where,
    select: {
      id: true,
      code: true,
      description: true,
      scope: true,
      type: true,
      value: true,
      maxDiscount: true,
      maxUses: true,
      usedCount: true,
      maxUsesPerUser: true,
      minAmount: true,
      sportFilter: true,
      categoryFilter: true,
      categoryExclude: true,
      userGroupFilter: true,
      validPlatforms: true,
      isStackable: true,
      stackGroup: true,
      isPublic: true,
      isSystemCode: true,
      isActive: true,
      validFrom: true,
      validUntil: true,
      createdAt: true,
      conditions: {
        select: { conditionType: true, conditionValue: true },
      },
      eligibleUsers: {
        select: {
          user: {
            select: { id: true, name: true, email: true, phone: true },
          },
        },
      },
      eligibleGroups: {
        select: {
          group: { select: { id: true, name: true } },
        },
      },
      _count: { select: { usages: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // Flatten the join rows so the mobile client gets the same shape the
  // web manager's CouponRow uses (eligibleUsers / eligibleGroups).
  const shaped = coupons.map((c) => ({
    ...c,
    eligibleUsers: c.eligibleUsers.map((e) => e.user),
    eligibleGroups: c.eligibleGroups
      .filter((e) => e.group)
      .map((e) => ({ id: e.group.id, name: e.group.name })),
  }));

  return NextResponse.json({ coupons: shaped });
}

export async function POST(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_COUPONS");
  if ("error" in gate) return gate.error;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid data" },
      { status: 400 },
    );
  }
  const d = parsed.data;
  const code = d.code.toUpperCase().trim();

  const existing = await db.coupon.findUnique({ where: { code } });
  if (existing) {
    return NextResponse.json(
      { error: "Coupon code already exists" },
      { status: 400 },
    );
  }
  if (d.type === "PERCENTAGE" && d.value > 10000) {
    return NextResponse.json(
      { error: "Percentage cannot exceed 100%" },
      { status: 400 },
    );
  }

  const eligibleUserIds = Array.from(new Set(d.eligibleUserIds));
  const eligibleGroupIds = Array.from(new Set(d.eligibleGroupIds));

  await db.coupon.create({
    data: {
      code,
      description: d.description?.trim() || null,
      scope: d.scope as CouponScope,
      type: d.type as DiscountType,
      value: d.value,
      maxDiscount: d.maxDiscount ?? null,
      maxUses: d.maxUses ?? null,
      maxUsesPerUser: d.maxUsesPerUser,
      minAmount: d.minAmount ?? null,
      sportFilter: d.sportFilter,
      categoryFilter: d.categoryFilter,
      categoryExclude: d.categoryExclude,
      userGroupFilter: d.userGroupFilter,
      validPlatforms: d.validPlatforms,
      isStackable: d.isStackable,
      stackGroup: d.stackGroup?.trim() || null,
      isPublic: d.isPublic,
      isSystemCode: d.isSystemCode,
      validFrom: new Date(d.validFrom),
      validUntil: new Date(d.validUntil),
      isActive: true,
      createdBy: gate.admin.id,
      conditions: {
        create: d.conditions.map((c) => ({
          conditionType: c.conditionType as CouponConditionType,
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
  return NextResponse.json({ ok: true });
}
