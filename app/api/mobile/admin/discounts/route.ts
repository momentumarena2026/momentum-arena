import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import {
  getDiscountCodes,
  createDiscountCode,
} from "@/actions/admin-discounts";
import type { DiscountType, Sport } from "@prisma/client";

/**
 * Mobile admin legacy discount codes. Mirrors web /admin/discounts
 * (actions/admin-discounts.ts getDiscountCodes + createDiscountCode).
 *
 * Units (match the DiscountCode model + web form):
 *   - PERCENTAGE value = basis points (1000 = 10%).
 *   - FLAT value = whole rupees.
 *   - minBookingAmount = whole rupees.
 * The client converts ₹/% inputs before sending. Gated on
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

export async function GET(request: NextRequest) {
  const g = await guard(request);
  if ("error" in g) return g.error;

  const url = new URL(request.url);
  const showInactive = url.searchParams.get("showInactive") === "1";
  const page = Math.max(parseInt(url.searchParams.get("page") || "1", 10), 1);

  const data = await getDiscountCodes({ page, showInactive });
  // Strip the action's _count include down to the usages count the
  // client renders, keeping the wire payload lean.
  return NextResponse.json({
    codes: data.codes.map((c) => ({
      id: c.id,
      code: c.code,
      type: c.type,
      value: c.value,
      maxUses: c.maxUses,
      usedCount: c.usedCount,
      maxUsesPerUser: c.maxUsesPerUser,
      minBookingAmount: c.minBookingAmount,
      sportFilter: c.sportFilter,
      validFrom: c.validFrom.toISOString(),
      validUntil: c.validUntil.toISOString(),
      isSystemCode: c.isSystemCode,
      isActive: c.isActive,
      usages: c._count.usages,
      createdAt: c.createdAt.toISOString(),
    })),
    total: data.total,
    page: data.page,
    totalPages: data.totalPages,
  });
}

const createSchema = z.object({
  code: z.string().min(3).max(20),
  type: z.enum(["PERCENTAGE", "FLAT"]),
  value: z.number().int().min(1),
  maxUses: z.number().int().min(1).nullish(),
  maxUsesPerUser: z.number().int().min(1).default(1),
  minBookingAmount: z.number().int().min(0).nullish(),
  sportFilter: z.array(z.enum(["CRICKET", "FOOTBALL", "PICKLEBALL"])).default([]),
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

  const result = await createDiscountCode(
    {
      code: d.code,
      type: d.type as DiscountType,
      value: d.value,
      maxUses: d.maxUses ?? undefined,
      maxUsesPerUser: d.maxUsesPerUser,
      minBookingAmount: d.minBookingAmount ?? undefined,
      sportFilter: d.sportFilter as Sport[],
      validFrom: d.validFrom,
      validUntil: d.validUntil,
    },
  );
  if (!result.success) {
    return NextResponse.json(
      { error: result.error ?? "Create failed" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
