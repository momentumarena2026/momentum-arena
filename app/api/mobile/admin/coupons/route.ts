import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import type { CouponScope, DiscountType } from "@prisma/client";

/**
 * Mobile admin unified coupons. Mirrors actions/admin-coupons.ts
 * (getCoupons + createCoupon) under MANAGE_COUPONS, scoped to the common
 * fields — advanced targeting (user groups / eligible users) + conditions +
 * stacking stay on web.
 *
 * Units (match the Coupon model): PERCENTAGE value = basis points (10% =
 * 1000); FLAT value = paise; maxDiscount = paise; minAmount = whole rupees.
 * The client converts ₹/% inputs before sending.
 */
async function guard(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (
    admin.role !== "SUPERADMIN" &&
    !hasPermission(admin.permissions ?? [], "MANAGE_COUPONS")
  ) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { admin };
}

export async function GET(request: NextRequest) {
  const g = await guard(request);
  if ("error" in g) return g.error;

  const showInactive = new URL(request.url).searchParams.get("showInactive") === "1";
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
      isPublic: true,
      isActive: true,
      validFrom: true,
      validUntil: true,
      createdAt: true,
      _count: { select: { usages: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ coupons });
}

const createSchema = z.object({
  code: z.string().min(3).max(20),
  description: z.string().optional(),
  scope: z.enum(["BOTH", "SPORTS", "CAFE"]),
  type: z.enum(["PERCENTAGE", "FLAT"]),
  value: z.number().int().positive(),
  maxDiscount: z.number().int().positive().nullish(),
  maxUses: z.number().int().positive().nullish(),
  maxUsesPerUser: z.number().int().min(1).default(1),
  minAmount: z.number().int().min(0).nullish(),
  isPublic: z.boolean().optional(),
  validFrom: z.string().min(1),
  validUntil: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const g = await guard(request);
  if ("error" in g) return g.error;

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
    return NextResponse.json({ error: "Coupon code already exists" }, { status: 400 });
  }
  if (d.type === "PERCENTAGE" && d.value > 10000) {
    return NextResponse.json({ error: "Percentage cannot exceed 100%" }, { status: 400 });
  }

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
      isPublic: d.isPublic ?? true,
      sportFilter: [],
      categoryFilter: [],
      userGroupFilter: [],
      validFrom: new Date(d.validFrom),
      validUntil: new Date(d.validUntil),
      isActive: true,
      createdBy: g.admin.id,
    },
  });
  return NextResponse.json({ ok: true });
}
