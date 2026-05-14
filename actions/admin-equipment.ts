"use server";

import { requireAdmin as requireAdminBase } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { Sport, BookingCategory } from "@prisma/client";

async function requireAdmin() {
  const user = await requireAdminBase();
  return user.id;
}

export async function createEquipment(data: {
  name: string;
  sport?: Sport | null;
  // Within CRICKET, narrows the item to a sub-flow. Bowling kit /
  // bat / L-guard get BOWLING_MACHINE; pass null for items that
  // should show on every cricket booking type.
  category?: BookingCategory | null;
  pricePerHour: number;
  totalUnits: number;
  imageUrl?: string;
  isCustomerSelectable?: boolean;
  displayOrder?: number;
}) {
  await requireAdmin();

  if (!data.name.trim()) {
    return { success: false, error: "Equipment name is required" };
  }

  if (data.pricePerHour <= 0) {
    return { success: false, error: "Price must be greater than 0" };
  }

  if (data.totalUnits <= 0) {
    return { success: false, error: "Total units must be at least 1" };
  }

  const equipment = await db.equipment.create({
    data: {
      name: data.name.trim(),
      sport: data.sport || null,
      category: data.category ?? null,
      pricePerHour: data.pricePerHour,
      totalUnits: data.totalUnits,
      availableUnits: data.totalUnits,
      isActive: true,
      imageUrl: data.imageUrl || null,
      isCustomerSelectable: data.isCustomerSelectable ?? true,
      displayOrder: data.displayOrder ?? 0,
    },
  });

  return { success: true, equipment };
}

export async function updateEquipment(
  id: string,
  data: Partial<{
    name: string;
    sport: Sport | null;
    category: BookingCategory | null;
    pricePerHour: number;
    totalUnits: number;
    availableUnits: number;
    isActive: boolean;
    imageUrl: string | null;
    isCustomerSelectable: boolean;
    displayOrder: number;
  }>
) {
  await requireAdmin();

  const existing = await db.equipment.findUnique({ where: { id } });
  if (!existing) {
    return { success: false, error: "Equipment not found" };
  }

  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name.trim();
  if (data.sport !== undefined) updateData.sport = data.sport;
  if (data.category !== undefined) updateData.category = data.category;
  if (data.pricePerHour !== undefined) updateData.pricePerHour = data.pricePerHour;
  if (data.totalUnits !== undefined) updateData.totalUnits = data.totalUnits;
  if (data.availableUnits !== undefined)
    updateData.availableUnits = data.availableUnits;
  if (data.isActive !== undefined) updateData.isActive = data.isActive;
  if (data.imageUrl !== undefined) updateData.imageUrl = data.imageUrl;
  if (data.isCustomerSelectable !== undefined)
    updateData.isCustomerSelectable = data.isCustomerSelectable;
  if (data.displayOrder !== undefined) updateData.displayOrder = data.displayOrder;

  const updated = await db.equipment.update({
    where: { id },
    data: updateData,
  });

  return { success: true, equipment: updated };
}

export async function deleteEquipment(id: string) {
  await requireAdmin();

  const existing = await db.equipment.findUnique({
    where: { id },
    include: { _count: { select: { rentals: true } } },
  });

  if (!existing) {
    return { success: false, error: "Equipment not found" };
  }

  // Soft delete if it has rentals
  if (existing._count.rentals > 0) {
    await db.equipment.update({
      where: { id },
      data: { isActive: false },
    });
    return { success: true, message: "Equipment deactivated (has existing rentals)" };
  }

  await db.equipment.delete({ where: { id } });
  return { success: true };
}

export async function getEquipmentList(filters?: {
  sport?: Sport;
  category?: BookingCategory | null;
  showInactive?: boolean;
  page?: number;
}) {
  await requireAdmin();

  const page = filters?.page ?? 1;
  const limit = 50;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (!filters?.showInactive) {
    where.isActive = true;
  }
  if (filters?.sport) {
    where.sport = filters.sport;
  }
  if (filters?.category !== undefined) {
    where.category = filters.category;
  }

  const [equipmentList, total] = await Promise.all([
    db.equipment.findMany({
      where,
      include: {
        _count: { select: { rentals: true } },
      },
      // displayOrder first so the customer-facing checkout (which
      // shares this query) renders the admin's chosen sequence.
      // Stable secondary sort by createdAt so re-ordered items
      // don't jiggle when displayOrder ties.
      orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }],
      skip,
      take: limit,
    }),
    db.equipment.count({ where }),
  ]);

  return {
    equipment: equipmentList,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getEquipmentStats() {
  await requireAdmin();

  const equipment = await db.equipment.findMany({
    where: { isActive: true },
    include: {
      rentals: {
        include: {
          booking: {
            select: { status: true, date: true },
          },
        },
      },
    },
  });

  const stats = equipment.map((eq) => {
    const confirmedRentals = eq.rentals.filter(
      (r) => r.booking.status === "CONFIRMED"
    );

    const totalRevenuePaise = confirmedRentals.reduce(
      (sum, r) => sum + r.totalPrice,
      0
    );

    const totalUnitsRented = confirmedRentals.reduce(
      (sum, r) => sum + r.quantity,
      0
    );

    const utilizationRate =
      eq.totalUnits > 0
        ? Math.round((totalUnitsRented / (eq.totalUnits * eq.rentals.length || 1)) * 100)
        : 0;

    return {
      id: eq.id,
      name: eq.name,
      sport: eq.sport,
      totalUnits: eq.totalUnits,
      availableUnits: eq.availableUnits,
      totalRentals: confirmedRentals.length,
      totalRevenuePaise,
      utilizationRate,
    };
  });

  const totalRevenuePaise = stats.reduce(
    (sum, s) => sum + s.totalRevenuePaise,
    0
  );

  return { stats, totalRevenuePaise };
}
