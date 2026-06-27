"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin as requireAdminBase } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { deleteProductImage } from "@/lib/blob";
import { recordStockMovement } from "@/lib/product";

/**
 * Admin actions for the shop catalog (products + categories).
 * Permissions:
 *   - MANAGE_SHOP_CATALOG: required for everything in this file.
 * Stock mutations go through the same recordStockMovement audit
 * trail the order flow uses, so a hand-edit (RESTOCK / ADJUSTMENT)
 * shows up alongside SALE rows.
 */

async function requireCatalogAdmin() {
  const user = await requireAdminBase("MANAGE_SHOP_CATALOG");
  return user.id;
}

// ─── Categories ──────────────────────────────────────────────────────

export async function createProductCategory(data: {
  name: string;
  displayOrder?: number;
}) {
  await requireCatalogAdmin();
  if (!data.name.trim()) {
    return { success: false, error: "Category name is required" };
  }
  const category = await db.productCategory.create({
    data: {
      name: data.name.trim(),
      displayOrder: data.displayOrder ?? 0,
    },
  });
  revalidatePath("/admin/products");
  return { success: true, category };
}

export async function updateProductCategory(
  id: string,
  data: Partial<{ name: string; displayOrder: number; isActive: boolean }>,
) {
  await requireCatalogAdmin();
  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) {
    if (!data.name.trim()) {
      return { success: false, error: "Category name is required" };
    }
    updateData.name = data.name.trim();
  }
  if (data.displayOrder !== undefined) updateData.displayOrder = data.displayOrder;
  if (data.isActive !== undefined) updateData.isActive = data.isActive;
  const category = await db.productCategory.update({
    where: { id },
    data: updateData,
  });
  revalidatePath("/admin/products");
  return { success: true, category };
}

export async function deleteProductCategory(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  await requireCatalogAdmin();
  try {
    // Detach products from the category instead of cascading the
    // delete — the products themselves are still valid, just
    // uncategorised. Matches the schema's `onDelete: SetNull`.
    await db.product.updateMany({
      where: { categoryId: id },
      data: { categoryId: null },
    });
    await db.productCategory.delete({ where: { id } });
    revalidatePath("/admin/products");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Delete failed",
    };
  }
}

export async function listProductCategories() {
  await requireCatalogAdmin();
  return db.productCategory.findMany({
    where: { isActive: true },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }],
  });
}

// ─── Products ────────────────────────────────────────────────────────

export async function createProduct(data: {
  name: string;
  description?: string | null;
  pricePaise: number;
  /** Optional cost-of-goods per unit in paise. Defaults to 0 if
   *  omitted — analytics treats 0-cost rows as "margin unknown". */
  costPaise?: number;
  stockQuantity: number;
  lowStockThreshold?: number;
  imageUrl?: string | null;
  categoryId?: string | null;
  displayOrder?: number;
}, adminIdOverride?: string) {
  // adminIdOverride lets the mobile route (bearer auth) reuse this action.
  const adminId = adminIdOverride ?? (await requireCatalogAdmin());
  if (!data.name.trim()) {
    return { success: false, error: "Product name is required" };
  }
  if (!Number.isInteger(data.pricePaise) || data.pricePaise <= 0) {
    return { success: false, error: "Price must be a positive integer (paise)" };
  }
  if (data.costPaise !== undefined) {
    if (!Number.isInteger(data.costPaise) || data.costPaise < 0) {
      return {
        success: false,
        error: "Cost must be a non-negative integer (paise)",
      };
    }
  }
  if (!Number.isInteger(data.stockQuantity) || data.stockQuantity < 0) {
    return { success: false, error: "Stock must be a non-negative integer" };
  }

  const product = await db.$transaction(async (tx) => {
    const created = await tx.product.create({
      data: {
        name: data.name.trim(),
        description: data.description?.trim() || null,
        pricePaise: data.pricePaise,
        costPaise: data.costPaise ?? 0,
        stockQuantity: data.stockQuantity,
        lowStockThreshold: data.lowStockThreshold ?? 3,
        imageUrl: data.imageUrl || null,
        categoryId: data.categoryId || null,
        displayOrder: data.displayOrder ?? 0,
      },
    });
    // Initial stock counts as a RESTOCK row so reports can trace
    // "where did these units come from?".
    if (data.stockQuantity > 0) {
      await recordStockMovement(tx, {
        productId: created.id,
        delta: data.stockQuantity,
        reason: "RESTOCK",
        note: "Initial stock on product creation",
        adminId,
      });
    }
    return created;
  });

  revalidatePath("/admin/products");
  return { success: true, product };
}

export async function updateProduct(
  id: string,
  data: Partial<{
    name: string;
    description: string | null;
    pricePaise: number;
    costPaise: number;
    lowStockThreshold: number;
    imageUrl: string | null;
    categoryId: string | null;
    isActive: boolean;
    displayOrder: number;
  }>,
  adminIdOverride?: string,
) {
  if (!adminIdOverride) await requireCatalogAdmin();
  const existing = await db.product.findUnique({ where: { id } });
  if (!existing) return { success: false, error: "Product not found" };

  if (data.pricePaise !== undefined) {
    if (!Number.isInteger(data.pricePaise) || data.pricePaise <= 0) {
      return { success: false, error: "Price must be a positive integer (paise)" };
    }
  }
  if (data.costPaise !== undefined) {
    if (!Number.isInteger(data.costPaise) || data.costPaise < 0) {
      return {
        success: false,
        error: "Cost must be a non-negative integer (paise)",
      };
    }
  }
  if (data.name !== undefined && !data.name.trim()) {
    return { success: false, error: "Product name is required" };
  }

  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name.trim();
  if (data.description !== undefined) updateData.description = data.description?.trim() || null;
  if (data.pricePaise !== undefined) updateData.pricePaise = data.pricePaise;
  if (data.costPaise !== undefined) updateData.costPaise = data.costPaise;
  if (data.lowStockThreshold !== undefined) updateData.lowStockThreshold = data.lowStockThreshold;
  if (data.categoryId !== undefined) updateData.categoryId = data.categoryId || null;
  if (data.isActive !== undefined) updateData.isActive = data.isActive;
  if (data.displayOrder !== undefined) updateData.displayOrder = data.displayOrder;

  // Image change: when the new URL differs from the existing one,
  // best-effort delete the old blob so the bucket doesn't fill up
  // with orphans.
  if (data.imageUrl !== undefined) {
    updateData.imageUrl = data.imageUrl || null;
    if (existing.imageUrl && existing.imageUrl !== data.imageUrl) {
      await deleteProductImage(existing.imageUrl);
    }
  }

  const product = await db.product.update({ where: { id }, data: updateData });
  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${id}`);
  revalidatePath("/shop");
  return { success: true, product };
}

export async function deleteProduct(id: string, adminIdOverride?: string) {
  if (!adminIdOverride) await requireCatalogAdmin();
  const existing = await db.product.findUnique({
    where: { id },
    include: { _count: { select: { orderItems: true } } },
  });
  if (!existing) return { success: false, error: "Product not found" };

  // Soft delete (deactivate) when the product is referenced by any
  // historical order — preserves order line items for accounting.
  if (existing._count.orderItems > 0) {
    await db.product.update({
      where: { id },
      data: { isActive: false },
    });
    revalidatePath("/admin/products");
    revalidatePath("/shop");
    return { success: true, message: "Product deactivated (has existing orders)" };
  }

  if (existing.imageUrl) await deleteProductImage(existing.imageUrl);
  await db.product.delete({ where: { id } });
  revalidatePath("/admin/products");
  revalidatePath("/shop");
  return { success: true };
}

/**
 * Adjust stock by a SIGNED delta. Positive = restock, negative =
 * shrinkage / manual reduction. Refuses to push stock below zero.
 * Writes a ProductStockMovement so the audit trail captures who
 * made the change and why.
 */
export async function adjustProductStock(args: {
  productId: string;
  delta: number;
  note: string;
}, adminIdOverride?: string) {
  const adminId = adminIdOverride ?? (await requireCatalogAdmin());
  if (!Number.isInteger(args.delta) || args.delta === 0) {
    return { success: false, error: "Delta must be a non-zero integer" };
  }
  if (!args.note.trim()) {
    return { success: false, error: "Note is required for the audit trail" };
  }

  const result = await db.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: args.productId },
      select: { stockQuantity: true },
    });
    if (!product) return { success: false as const, error: "Product not found" };

    const newStock = product.stockQuantity + args.delta;
    if (newStock < 0) {
      return {
        success: false as const,
        error: `Stock would go negative (current ${product.stockQuantity}, delta ${args.delta})`,
      };
    }

    await tx.product.update({
      where: { id: args.productId },
      data: { stockQuantity: newStock },
    });
    await recordStockMovement(tx, {
      productId: args.productId,
      delta: args.delta,
      reason: args.delta > 0 ? "RESTOCK" : "ADJUSTMENT",
      note: args.note.trim(),
      adminId,
    });
    return { success: true as const, newStock };
  });

  revalidatePath("/admin/products");
  return result;
}

/** Admin-facing product list, including inactive items + stock movement counts. */
export async function listProductsForAdmin(opts?: {
  showInactive?: boolean;
  categoryId?: string | null;
}) {
  await requireCatalogAdmin();
  const where: Record<string, unknown> = {};
  if (!opts?.showInactive) where.isActive = true;
  if (opts?.categoryId !== undefined) where.categoryId = opts.categoryId;

  const rows = await db.product.findMany({
    where,
    include: {
      category: true,
      _count: { select: { orderItems: true } },
    },
    orderBy: [
      { category: { displayOrder: "asc" } },
      { displayOrder: "asc" },
      { createdAt: "desc" },
    ],
  });
  return rows;
}

export async function getProductStockMovements(productId: string, limit = 50) {
  await requireCatalogAdmin();
  return db.productStockMovement.findMany({
    where: { productId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
