import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import type { Sport, BookingCategory } from "@prisma/client";

/**
 * Mobile admin equipment. Mirrors actions/admin-equipment.ts
 * (getEquipmentList + createEquipment) under MANAGE_SPORTS.
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

export async function GET(request: NextRequest) {
  const g = await guard(request);
  if ("error" in g) return g.error;

  const showInactive = new URL(request.url).searchParams.get("showInactive") === "1";
  const where: Record<string, unknown> = {};
  if (!showInactive) where.isActive = true;

  const equipment = await db.equipment.findMany({
    where,
    include: { _count: { select: { rentals: true } } },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }],
    take: 100,
  });
  return NextResponse.json({ equipment });
}

const createSchema = z.object({
  name: z.string().min(1),
  sport: z.enum(["CRICKET", "FOOTBALL", "PICKLEBALL"]).nullish(),
  category: z.string().nullish(),
  pricePerHour: z.number().positive(),
  totalUnits: z.number().int().positive(),
  isCustomerSelectable: z.boolean().optional(),
  displayOrder: z.number().int().optional(),
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
  const equipment = await db.equipment.create({
    data: {
      name: d.name.trim(),
      sport: (d.sport ?? null) as Sport | null,
      category: (d.category ?? null) as BookingCategory | null,
      pricePerHour: d.pricePerHour,
      totalUnits: d.totalUnits,
      availableUnits: d.totalUnits,
      isActive: true,
      isCustomerSelectable: d.isCustomerSelectable ?? true,
      displayOrder: d.displayOrder ?? 0,
    },
  });
  return NextResponse.json({ ok: true, equipment });
}
