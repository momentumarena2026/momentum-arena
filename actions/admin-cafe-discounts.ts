"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin as requireAdminBase } from "@/lib/admin-auth";
import { CafeItemCategory, DiscountType } from "@prisma/client";

async function requireAdmin() {
  const user = await requireAdminBase("MANAGE_CAFE_DISCOUNTS");
  return user.id;
}

const cafeCouponSchema = z.object({
  code: z.string().min(3).max(20),
  type: z.enum(["PERCENTAGE", "FLAT"]),
  value: z.number().int().min(1),
  maxUses: z.number().int().min(1).optional(),
  maxUsesPerUser: z.number().int().min(1).default(1),
  minOrderAmount: z.number().int().min(0).optional(),
  categoryFilter: z
    .array(z.enum(["SNACKS", "BEVERAGES", "MEALS", "DESSERTS", "COMBOS"]))
    .default([]),
  validFrom: z.string().min(1),
  validUntil: z.string().min(1),
});

export async function createCafeCoupon(data: {
  code: string;
  type: DiscountType;
  value: number;
  maxUses?: number;
  maxUsesPerUser?: number;
  minOrderAmount?: number;
  categoryFilter?: CafeItemCategory[];
  validFrom: string;
  validUntil: string;
}) {
  const adminId = await requireAdmin();

  const parsed = cafeCouponSchema.safeParse(data);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Invalid data",
    };
  }

  const code = parsed.data.code.toUpperCase().trim();

  // Check uniqueness
  const existing = await db.cafeDiscount.findUnique({ where: { code } });
  if (existing) return { success: false, error: "Code already exists" };

  // Validate percentage <= 10000 basis points (100%)
  if (parsed.data.type === "PERCENTAGE" && parsed.data.value > 10000) {
    return { success: false, error: "Percentage cannot exceed 100%" };
  }

  try {
    await db.cafeDiscount.create({
      data: {
        code,
        type: parsed.data.type,
        value: parsed.data.value,
        maxUses: parsed.data.maxUses || null,
        maxUsesPerUser: parsed.data.maxUsesPerUser,
        minOrderAmount: parsed.data.minOrderAmount || null,
        categoryFilter: parsed.data.categoryFilter,
        validFrom: new Date(parsed.data.validFrom),
        validUntil: new Date(parsed.data.validUntil),
        createdBy: adminId,
      },
    });

    return { success: true };
  } catch (error) {
    console.error("Failed to create cafe coupon:", error);
    return { success: false, error: "Failed to create coupon" };
  }
}

export async function updateCafeCoupon(
  id: string,
  data: Partial<{
    value: number;
    maxUses: number;
    maxUsesPerUser: number;
    minOrderAmount: number;
    categoryFilter: CafeItemCategory[];
    validFrom: string;
    validUntil: string;
    isActive: boolean;
  }>
) {
  await requireAdmin();

  try {
    const updateData: Record<string, unknown> = {};
    if (data.value !== undefined) updateData.value = data.value;
    if (data.maxUses !== undefined) updateData.maxUses = data.maxUses;
    if (data.maxUsesPerUser !== undefined)
      updateData.maxUsesPerUser = data.maxUsesPerUser;
    if (data.minOrderAmount !== undefined)
      updateData.minOrderAmount = data.minOrderAmount;
    if (data.categoryFilter !== undefined)
      updateData.categoryFilter = data.categoryFilter;
    if (data.validFrom !== undefined)
      updateData.validFrom = new Date(data.validFrom);
    if (data.validUntil !== undefined)
      updateData.validUntil = new Date(data.validUntil);
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    await db.cafeDiscount.update({ where: { id }, data: updateData });
    return { success: true };
  } catch (error) {
    console.error("Failed to update cafe coupon:", error);
    return { success: false, error: "Failed to update coupon" };
  }
}

export async function deleteCafeCoupon(id: string) {
  await requireAdmin();

  try {
    const code = await db.cafeDiscount.findUnique({ where: { id } });
    if (!code) return { success: false, error: "Coupon not found" };

    await db.cafeDiscount.update({
      where: { id },
      data: { isActive: false },
    });
    return { success: true };
  } catch (error) {
    console.error("Failed to delete cafe coupon:", error);
    return { success: false, error: "Failed to delete coupon" };
  }
}

export async function getCafeCoupons(filters?: {
  page?: number;
  showInactive?: boolean;
}) {
  await requireAdmin();

  const page = filters?.page ?? 1;
  const limit = 20;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (!filters?.showInactive) {
    where.isActive = true;
  }

  const [coupons, total] = await Promise.all([
    db.cafeDiscount.findMany({
      where,
      include: { _count: { select: { usages: true } } },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    db.cafeDiscount.count({ where }),
  ]);

  return { coupons, total, page, totalPages: Math.ceil(total / limit) };
}
