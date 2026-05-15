import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

/**
 * Read-side helpers for the customer-facing shop. All return shapes
 * are flat plain objects with paise integers — the page components
 * convert to rupees for display.
 */

export interface PublicProduct {
  id: string;
  name: string;
  description: string | null;
  pricePaise: number;
  stockQuantity: number;
  isInStock: boolean;
  imageUrl: string | null;
  categoryId: string | null;
  categoryName: string | null;
}

/**
 * Customer-facing product list — active, in-stock (or out-of-stock
 * but still visible so the customer knows the item exists), ordered
 * by category then displayOrder.
 *
 * Callers that want to hide out-of-stock entirely pass
 * `{ inStockOnly: true }`.
 */
export async function listShopProducts(opts?: {
  inStockOnly?: boolean;
}): Promise<PublicProduct[]> {
  const rows = await db.product.findMany({
    where: {
      isActive: true,
      ...(opts?.inStockOnly ? { stockQuantity: { gt: 0 } } : {}),
    },
    include: { category: true },
    orderBy: [
      { category: { displayOrder: "asc" } },
      { displayOrder: "asc" },
      { createdAt: "desc" },
    ],
  });

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    pricePaise: r.pricePaise,
    stockQuantity: r.stockQuantity,
    isInStock: r.stockQuantity > 0,
    imageUrl: r.imageUrl,
    categoryId: r.categoryId,
    categoryName: r.category?.name ?? null,
  }));
}

export async function getProductById(id: string): Promise<PublicProduct | null> {
  const r = await db.product.findUnique({
    where: { id },
    include: { category: true },
  });
  if (!r || !r.isActive) return null;
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    pricePaise: r.pricePaise,
    stockQuantity: r.stockQuantity,
    isInStock: r.stockQuantity > 0,
    imageUrl: r.imageUrl,
    categoryId: r.categoryId,
    categoryName: r.category?.name ?? null,
  };
}

/**
 * Atomically decrement stock for a product. Returns false when there
 * isn't enough stock — caller should treat that as a checkout
 * failure and refuse to commit the order. Uses a conditional
 * `updateMany` so the read-and-write happens as a single statement,
 * which is safe against concurrent checkouts without an advisory
 * lock.
 *
 * Pair with `recordStockMovement` inside the same Prisma
 * transaction so the audit trail stays in lock-step.
 */
export async function decrementStock(
  tx: Prisma.TransactionClient,
  productId: string,
  quantity: number,
): Promise<boolean> {
  const updated = await tx.product.updateMany({
    where: { id: productId, stockQuantity: { gte: quantity } },
    data: { stockQuantity: { decrement: quantity } },
  });
  return updated.count === 1;
}

/**
 * Restore stock — used when an order is cancelled or refunded.
 * Always succeeds (no conditional), since we trust the order's
 * snapshot of how much was originally reserved.
 */
export async function incrementStock(
  tx: Prisma.TransactionClient,
  productId: string,
  quantity: number,
): Promise<void> {
  await tx.product.update({
    where: { id: productId },
    data: { stockQuantity: { increment: quantity } },
  });
}

export async function recordStockMovement(
  tx: Prisma.TransactionClient,
  data: {
    productId: string;
    delta: number;
    reason:
      | "SALE"
      | "RESTOCK"
      | "ADJUSTMENT"
      | "REFUND"
      | "RELEASE";
    orderId?: string;
    note?: string;
    adminId?: string;
  },
): Promise<void> {
  await tx.productStockMovement.create({
    data: {
      productId: data.productId,
      delta: data.delta,
      reason: data.reason,
      orderId: data.orderId ?? null,
      note: data.note ?? null,
      adminId: data.adminId ?? null,
    },
  });
}

/**
 * Order-number generator. Format: SH-YYYYMMDD-XXXX where XXXX is
 * the first 4 chars of the cuid. Cheap, sortable, human-readable
 * on a receipt. Returned uppercase so it doesn't blend into prose.
 */
export function buildOrderNumber(orderId: string, date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const suffix = orderId.slice(-4).toUpperCase();
  return `SH-${yyyy}${mm}${dd}-${suffix}`;
}
