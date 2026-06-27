import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import type { Sport, BookingCategory } from "@prisma/client";

/**
 * Mobile admin equipment edit/delete. Mirrors updateEquipment +
 * deleteEquipment (soft-delete when rentals exist) in
 * actions/admin-equipment.ts.
 */
async function guard(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (
    admin.role !== "SUPERADMIN" &&
    !hasPermission(admin.permissions ?? [], "MANAGE_SPORTS")
  ) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { admin };
}

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  sport: z.enum(["CRICKET", "FOOTBALL", "PICKLEBALL"]).nullish(),
  category: z.string().nullish(),
  pricePerHour: z.number().positive().optional(),
  totalUnits: z.number().int().positive().optional(),
  availableUnits: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  isCustomerSelectable: z.boolean().optional(),
  displayOrder: z.number().int().optional(),
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
  if (d.name !== undefined) data.name = d.name.trim();
  if (d.sport !== undefined) data.sport = (d.sport ?? null) as Sport | null;
  if (d.category !== undefined)
    data.category = (d.category ?? null) as BookingCategory | null;
  if (d.pricePerHour !== undefined) data.pricePerHour = d.pricePerHour;
  if (d.totalUnits !== undefined) data.totalUnits = d.totalUnits;
  if (d.availableUnits !== undefined) data.availableUnits = d.availableUnits;
  if (d.isActive !== undefined) data.isActive = d.isActive;
  if (d.isCustomerSelectable !== undefined)
    data.isCustomerSelectable = d.isCustomerSelectable;
  if (d.displayOrder !== undefined) data.displayOrder = d.displayOrder;

  await db.equipment.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard(request);
  if ("error" in g) return g.error;
  const { id } = await params;

  const existing = await db.equipment.findUnique({
    where: { id },
    include: { _count: { select: { rentals: true } } },
  });
  if (!existing) {
    return NextResponse.json({ error: "Equipment not found" }, { status: 404 });
  }
  // Soft-delete when rentals reference it; hard-delete otherwise.
  if (existing._count.rentals > 0) {
    await db.equipment.update({ where: { id }, data: { isActive: false } });
    return NextResponse.json({ ok: true, softDeleted: true });
  }
  await db.equipment.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
