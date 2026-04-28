"use server";

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { CafeItemCategory } from "@prisma/client";

async function requireCafeMenuAdmin() {
  const user = await requireAdmin("MANAGE_CAFE_MENU");
  return user.id;
}

/**
 * Mobile admin routes pre-authenticate via JWT and pass `skipAuth:
 * true` here to bypass the NextAuth web cookie gate. Web call sites
 * omit the flag.
 */

export async function getCafeItems(filters?: {
  category?: CafeItemCategory;
  search?: string;
  showUnavailable?: boolean;
}, skipAuth?: boolean) {
  if (!skipAuth) await requireCafeMenuAdmin();

  const where: Record<string, unknown> = {};

  if (filters?.category) {
    where.category = filters.category;
  }

  if (filters?.search) {
    where.OR = [
      { name: { contains: filters.search, mode: "insensitive" } },
      { description: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  if (!filters?.showUnavailable) {
    where.isAvailable = true;
  }

  const items = await db.cafeItem.findMany({
    where,
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });

  // Group by category
  const grouped: Record<string, typeof items> = {};
  for (const item of items) {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  }

  return { items, grouped };
}

export async function createCafeItem(data: {
  name: string;
  description?: string;
  category: CafeItemCategory;
  price: number;
  image?: string;
  isVeg: boolean;
  tags?: string[];
}) {
  await requireCafeMenuAdmin();

  try {
    if (!data.name || !data.category || !data.price) {
      return { success: false, error: "Name, category and price are required" };
    }

    if (data.price <= 0) {
      return { success: false, error: "Price must be positive" };
    }

    // Get max sort order for this category
    const maxSort = await db.cafeItem.findFirst({
      where: { category: data.category },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });

    const item = await db.cafeItem.create({
      data: {
        name: data.name.trim(),
        description: data.description?.trim() || null,
        category: data.category,
        price: data.price,
        image: data.image?.trim() || null,
        isVeg: data.isVeg,
        tags: data.tags || [],
        sortOrder: (maxSort?.sortOrder ?? 0) + 1,
      },
    });

    return { success: true, item };
  } catch (error) {
    console.error("Failed to create cafe item:", error);
    return { success: false, error: "Failed to create item" };
  }
}

export async function updateCafeItem(
  id: string,
  data: Partial<{
    name: string;
    description: string | null;
    category: CafeItemCategory;
    price: number;
    image: string | null;
    isVeg: boolean;
    tags: string[];
  }>
) {
  await requireCafeMenuAdmin();

  try {
    const existing = await db.cafeItem.findUnique({ where: { id } });
    if (!existing) return { success: false, error: "Item not found" };

    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name.trim();
    if (data.description !== undefined)
      updateData.description = data.description?.trim() || null;
    if (data.category !== undefined) updateData.category = data.category;
    if (data.price !== undefined) {
      if (data.price <= 0) return { success: false, error: "Price must be positive" };
      updateData.price = data.price;
    }
    if (data.image !== undefined) updateData.image = data.image?.trim() || null;
    if (data.isVeg !== undefined) updateData.isVeg = data.isVeg;
    if (data.tags !== undefined) updateData.tags = data.tags;

    await db.cafeItem.update({ where: { id }, data: updateData });
    return { success: true };
  } catch (error) {
    console.error("Failed to update cafe item:", error);
    return { success: false, error: "Failed to update item" };
  }
}

export async function deleteCafeItem(id: string) {
  await requireCafeMenuAdmin();

  try {
    const existing = await db.cafeItem.findUnique({ where: { id } });
    if (!existing) return { success: false, error: "Item not found" };

    await db.cafeItem.update({ where: { id }, data: { isAvailable: false } });
    return { success: true };
  } catch (error) {
    console.error("Failed to delete cafe item:", error);
    return { success: false, error: "Failed to delete item" };
  }
}

export async function toggleCafeItemAvailability(
  id: string,
  skipAuth?: boolean,
) {
  if (!skipAuth) await requireCafeMenuAdmin();

  try {
    const item = await db.cafeItem.findUnique({ where: { id } });
    if (!item) return { success: false, error: "Item not found" };

    await db.cafeItem.update({
      where: { id },
      data: { isAvailable: !item.isAvailable },
    });
    return { success: true, isAvailable: !item.isAvailable };
  } catch (error) {
    console.error("Failed to toggle cafe item:", error);
    return { success: false, error: "Failed to toggle availability" };
  }
}

export async function reorderCafeItems(
  items: { id: string; sortOrder: number }[]
) {
  await requireCafeMenuAdmin();

  try {
    await db.$transaction(
      items.map((item) =>
        db.cafeItem.update({
          where: { id: item.id },
          data: { sortOrder: item.sortOrder },
        })
      )
    );
    return { success: true };
  } catch (error) {
    console.error("Failed to reorder cafe items:", error);
    return { success: false, error: "Failed to reorder items" };
  }
}
