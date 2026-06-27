import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import type { CouponScope } from "@prisma/client";

/**
 * Mobile admin coupon edit/disable. Mirrors updateCoupon (common fields) +
 * deleteCoupon (soft-delete = isActive false) in actions/admin-coupons.ts.
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

const patchSchema = z.object({
  description: z.string().nullish(),
  scope: z.enum(["BOTH", "SPORTS", "CAFE"]).optional(),
  value: z.number().int().positive().optional(),
  maxDiscount: z.number().int().positive().nullish(),
  maxUses: z.number().int().positive().nullish(),
  maxUsesPerUser: z.number().int().min(1).optional(),
  minAmount: z.number().int().min(0).nullish(),
  isPublic: z.boolean().optional(),
  isActive: z.boolean().optional(),
  validFrom: z.string().min(1).optional(),
  validUntil: z.string().min(1).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard(request);
  if ("error" in g) return g.error;
  const { id } = await params;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid data" },
      { status: 400 },
    );
  }
  const d = parsed.data;
  const data: Record<string, unknown> = {};
  if (d.description !== undefined) data.description = d.description?.trim() || null;
  if (d.scope !== undefined) data.scope = d.scope as CouponScope;
  if (d.value !== undefined) data.value = d.value;
  if (d.maxDiscount !== undefined) data.maxDiscount = d.maxDiscount ?? null;
  if (d.maxUses !== undefined) data.maxUses = d.maxUses ?? null;
  if (d.maxUsesPerUser !== undefined) data.maxUsesPerUser = d.maxUsesPerUser;
  if (d.minAmount !== undefined) data.minAmount = d.minAmount ?? null;
  if (d.isPublic !== undefined) data.isPublic = d.isPublic;
  if (d.isActive !== undefined) data.isActive = d.isActive;
  if (d.validFrom !== undefined) data.validFrom = new Date(d.validFrom);
  if (d.validUntil !== undefined) data.validUntil = new Date(d.validUntil);

  await db.coupon.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard(request);
  if ("error" in g) return g.error;
  const { id } = await params;
  await db.coupon.update({ where: { id }, data: { isActive: false } });
  return NextResponse.json({ ok: true });
}
