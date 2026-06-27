import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";

/**
 * Mobile admin cafe coupons. Mirrors actions/admin-cafe-discounts.ts
 * (getCafeCoupons + createCafeCoupon) with bearer auth + the
 * MANAGE_CAFE_DISCOUNTS permission (SUPERADMIN bypass).
 */
async function requireCafeDiscountAdmin(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (
    admin.role !== "SUPERADMIN" &&
    !hasPermission(admin.permissions ?? [], "MANAGE_CAFE_DISCOUNTS")
  ) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { admin };
}

export async function GET(request: NextRequest) {
  const auth = await requireCafeDiscountAdmin(request);
  if ("error" in auth) return auth.error;

  const showInactive = new URL(request.url).searchParams.get("showInactive") === "1";
  const where: Record<string, unknown> = {};
  if (!showInactive) where.isActive = true;

  const coupons = await db.cafeDiscount.findMany({
    where,
    include: { _count: { select: { usages: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ coupons });
}

const createSchema = z.object({
  code: z.string().min(3).max(20),
  type: z.enum(["PERCENTAGE", "FLAT"]),
  value: z.number().positive(),
  maxUses: z.number().int().min(1).optional(),
  maxUsesPerUser: z.number().int().min(1).default(1),
  minOrderAmount: z.number().min(0).optional(),
  categoryFilter: z
    .array(z.enum(["SNACKS", "BEVERAGES", "MEALS", "DESSERTS", "COMBOS"]))
    .default([]),
  validFrom: z.string().min(1),
  validUntil: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const auth = await requireCafeDiscountAdmin(request);
  if ("error" in auth) return auth.error;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid data" },
      { status: 400 },
    );
  }
  const code = parsed.data.code.toUpperCase().trim();

  const existing = await db.cafeDiscount.findUnique({ where: { code } });
  if (existing) {
    return NextResponse.json({ error: "Code already exists" }, { status: 400 });
  }
  if (parsed.data.type === "PERCENTAGE" && parsed.data.value > 10000) {
    return NextResponse.json(
      { error: "Percentage cannot exceed 100%" },
      { status: 400 },
    );
  }

  await db.cafeDiscount.create({
    data: {
      code,
      type: parsed.data.type,
      value: parsed.data.value,
      maxUses: parsed.data.maxUses ?? null,
      maxUsesPerUser: parsed.data.maxUsesPerUser,
      minOrderAmount: parsed.data.minOrderAmount ?? null,
      categoryFilter: parsed.data.categoryFilter,
      validFrom: new Date(parsed.data.validFrom),
      validUntil: new Date(parsed.data.validUntil),
      createdBy: auth.admin.id,
    },
  });
  return NextResponse.json({ ok: true });
}
