import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";

/**
 * Mobile admin product category edit/delete. Mirrors updateProductCategory /
 * deleteProductCategory in actions/admin-products.ts under MANAGE_SHOP_CATALOG.
 * Delete detaches products (categoryId -> null) first, matching the web
 * action's onDelete: SetNull behaviour, so products survive uncategorised.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await requireMobileAdmin(request, "MANAGE_SHOP_CATALOG");
  if ("error" in g) return g.error;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) {
      return NextResponse.json({ error: "Category name is required" }, { status: 400 });
    }
    data.name = name;
  }
  if (body.displayOrder !== undefined) {
    data.displayOrder = Math.trunc(Number(body.displayOrder)) || 0;
  }
  if (body.isActive !== undefined) data.isActive = !!body.isActive;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: true });
  }
  const category = await db.productCategory.update({ where: { id }, data });
  return NextResponse.json({ ok: true, category });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await requireMobileAdmin(request, "MANAGE_SHOP_CATALOG");
  if ("error" in g) return g.error;
  const { id } = await params;

  try {
    // Detach products before deleting the category — they stay valid,
    // just uncategorised. Mirrors deleteProductCategory on web.
    await db.product.updateMany({
      where: { categoryId: id },
      data: { categoryId: null },
    });
    await db.productCategory.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Delete failed" },
      { status: 400 },
    );
  }
}
