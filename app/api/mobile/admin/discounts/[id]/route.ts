import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import {
  updateDiscountCode,
  deleteDiscountCode,
} from "@/actions/admin-discounts";
import type { Sport } from "@prisma/client";

/**
 * Mobile admin legacy discount-code edit / soft-delete. Mirrors
 * updateDiscountCode (PATCH — common fields) + deleteDiscountCode
 * (DELETE — soft-delete = isActive false; refuses system codes) in
 * actions/admin-discounts.ts.
 *
 * Units mirror the create route: PERCENTAGE value = basis points,
 * FLAT value + minBookingAmount = whole rupees. Gated on
 * MANAGE_DISCOUNTS.
 */
async function guard(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (
    admin.role !== "SUPERADMIN" &&
    !hasPermission(admin.permissions ?? [], "MANAGE_DISCOUNTS")
  ) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { admin };
}

const patchSchema = z.object({
  value: z.number().int().min(1).optional(),
  maxUses: z.number().int().min(1).optional(),
  maxUsesPerUser: z.number().int().min(1).optional(),
  minBookingAmount: z.number().int().min(0).optional(),
  sportFilter: z
    .array(z.enum(["CRICKET", "FOOTBALL", "PICKLEBALL"]))
    .optional(),
  validFrom: z.string().min(1).optional(),
  validUntil: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
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

  // updateDiscountCode always resolves { success: true } (it throws on
  // a bad id), so there's no error branch to forward here.
  await updateDiscountCode(
    id,
    {
      value: d.value,
      maxUses: d.maxUses,
      maxUsesPerUser: d.maxUsesPerUser,
      minBookingAmount: d.minBookingAmount,
      sportFilter: d.sportFilter as Sport[] | undefined,
      validFrom: d.validFrom,
      validUntil: d.validUntil,
      isActive: d.isActive,
    },
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard(request);
  if ("error" in g) return g.error;
  const { id } = await params;

  const result = await deleteDiscountCode(id);
  if (!result.success) {
    return NextResponse.json(
      { error: result.error ?? "Delete failed" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
