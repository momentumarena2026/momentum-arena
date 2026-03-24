"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { DiscountType, Sport } from "@prisma/client";
import { requireAdmin as requireAdminBase } from "@/lib/admin-auth";

async function requireAdmin() {
  const user = await requireAdminBase("MANAGE_DISCOUNTS");
  return user.id;
}

const discountSchema = z.object({
  code: z.string().min(3).max(20),
  type: z.enum(["PERCENTAGE", "FLAT"]),
  value: z.number().int().min(1),
  maxUses: z.number().int().min(1).optional(),
  maxUsesPerUser: z.number().int().min(1).default(1),
  minBookingAmount: z.number().int().min(0).optional(),
  sportFilter: z.array(z.enum(["CRICKET", "FOOTBALL", "PICKLEBALL", "BADMINTON"])).default([]),
  validFrom: z.string().min(1),
  validUntil: z.string().min(1),
  isSystemCode: z.boolean().default(false),
});

export async function createDiscountCode(data: {
  code: string;
  type: DiscountType;
  value: number;
  maxUses?: number;
  maxUsesPerUser?: number;
  minBookingAmount?: number;
  sportFilter?: Sport[];
  validFrom: string;
  validUntil: string;
  isSystemCode?: boolean;
}) {
  const adminId = await requireAdmin();

  const parsed = discountSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || "Invalid data" };
  }

  const code = parsed.data.code.toUpperCase().trim();

  // Check uniqueness
  const existing = await db.discountCode.findUnique({ where: { code } });
  if (existing) return { success: false, error: "Code already exists" };

  // Validate percentage <= 10000 basis points (100%)
  if (parsed.data.type === "PERCENTAGE" && parsed.data.value > 10000) {
    return { success: false, error: "Percentage cannot exceed 100%" };
  }

  await db.discountCode.create({
    data: {
      code,
      type: parsed.data.type,
      value: parsed.data.value,
      maxUses: parsed.data.maxUses || null,
      maxUsesPerUser: parsed.data.maxUsesPerUser,
      minBookingAmount: parsed.data.minBookingAmount || null,
      sportFilter: parsed.data.sportFilter,
      validFrom: new Date(parsed.data.validFrom),
      validUntil: new Date(parsed.data.validUntil),
      isSystemCode: parsed.data.isSystemCode,
      createdBy: adminId,
    },
  });

  return { success: true };
}

export async function updateDiscountCode(
  id: string,
  data: Partial<{
    value: number;
    maxUses: number;
    maxUsesPerUser: number;
    minBookingAmount: number;
    sportFilter: Sport[];
    validFrom: string;
    validUntil: string;
    isActive: boolean;
  }>
) {
  await requireAdmin();

  const updateData: Record<string, unknown> = {};
  if (data.value !== undefined) updateData.value = data.value;
  if (data.maxUses !== undefined) updateData.maxUses = data.maxUses;
  if (data.maxUsesPerUser !== undefined) updateData.maxUsesPerUser = data.maxUsesPerUser;
  if (data.minBookingAmount !== undefined) updateData.minBookingAmount = data.minBookingAmount;
  if (data.sportFilter !== undefined) updateData.sportFilter = data.sportFilter;
  if (data.validFrom !== undefined) updateData.validFrom = new Date(data.validFrom);
  if (data.validUntil !== undefined) updateData.validUntil = new Date(data.validUntil);
  if (data.isActive !== undefined) updateData.isActive = data.isActive;

  await db.discountCode.update({ where: { id }, data: updateData });
  return { success: true };
}

export async function deleteDiscountCode(id: string) {
  await requireAdmin();

  const code = await db.discountCode.findUnique({ where: { id } });
  if (!code) return { success: false, error: "Code not found" };
  if (code.isSystemCode) return { success: false, error: "Cannot delete system codes" };

  await db.discountCode.update({ where: { id }, data: { isActive: false } });
  return { success: true };
}

export async function getDiscountCodes(filters?: {
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

  const [codes, total] = await Promise.all([
    db.discountCode.findMany({
      where,
      include: { _count: { select: { usages: true } } },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    db.discountCode.count({ where }),
  ]);

  return { codes, total, page, totalPages: Math.ceil(total / limit) };
}
