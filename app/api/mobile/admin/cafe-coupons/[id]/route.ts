import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";

/**
 * Mobile admin cafe coupon edit/disable. Mirrors updateCafeCoupon +
 * deleteCafeCoupon (soft-delete = isActive false) in
 * actions/admin-cafe-discounts.ts.
 */
async function guard(request: NextRequest) {
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

const patchSchema = z.object({
  value: z.number().positive().optional(),
  maxUses: z.number().int().min(1).optional(),
  maxUsesPerUser: z.number().int().min(1).optional(),
  minOrderAmount: z.number().min(0).optional(),
  categoryFilter: z
    .array(z.enum(["SNACKS", "BEVERAGES", "MEALS", "DESSERTS", "COMBOS"]))
    .optional(),
  validFrom: z.string().min(1).optional(),
  validUntil: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await guard(request);
  if ("error" in auth) return auth.error;
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
  if (d.value !== undefined) data.value = d.value;
  if (d.maxUses !== undefined) data.maxUses = d.maxUses;
  if (d.maxUsesPerUser !== undefined) data.maxUsesPerUser = d.maxUsesPerUser;
  if (d.minOrderAmount !== undefined) data.minOrderAmount = d.minOrderAmount;
  if (d.categoryFilter !== undefined) data.categoryFilter = d.categoryFilter;
  if (d.validFrom !== undefined) data.validFrom = new Date(d.validFrom);
  if (d.validUntil !== undefined) data.validUntil = new Date(d.validUntil);
  if (d.isActive !== undefined) data.isActive = d.isActive;

  await db.cafeDiscount.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await guard(request);
  if ("error" in auth) return auth.error;
  const { id } = await params;

  await db.cafeDiscount.update({ where: { id }, data: { isActive: false } });
  return NextResponse.json({ ok: true });
}
