import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import { createProduct } from "@/actions/admin-products";

/**
 * Mobile admin product catalog. GET replicates listProductsForAdmin +
 * listProductCategories (reads); POST reuses createProduct via adminIdOverride
 * (keeps the stock-movement audit). Under MANAGE_SHOP_CATALOG. Image upload
 * stays on web (Vercel Blob) — mobile create/edit leaves imageUrl untouched.
 */
async function guard(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (
    admin.role !== "SUPERADMIN" &&
    !hasPermission(admin.permissions ?? [], "MANAGE_SHOP_CATALOG")
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

  const [products, categories] = await Promise.all([
    db.product.findMany({
      where,
      include: { category: true, _count: { select: { orderItems: true } } },
      orderBy: [
        { category: { displayOrder: "asc" } },
        { displayOrder: "asc" },
        { createdAt: "desc" },
      ],
    }),
    db.productCategory.findMany({ orderBy: { displayOrder: "asc" } }),
  ]);
  return NextResponse.json({ products, categories });
}

export async function POST(request: NextRequest) {
  const g = await guard(request);
  if ("error" in g) return g.error;

  const body = await request.json().catch(() => null);
  if (!body?.name || !Number.isFinite(Number(body.pricePaise))) {
    return NextResponse.json({ error: "Name and price are required" }, { status: 400 });
  }
  const result = await createProduct(
    {
      name: String(body.name),
      description: body.description ?? null,
      pricePaise: Math.trunc(Number(body.pricePaise)),
      costPaise: body.costPaise != null ? Math.trunc(Number(body.costPaise)) : undefined,
      stockQuantity: Math.max(0, Math.trunc(Number(body.stockQuantity) || 0)),
      lowStockThreshold: body.lowStockThreshold != null ? Math.trunc(Number(body.lowStockThreshold)) : undefined,
      categoryId: body.categoryId || null,
    },
    g.admin.id,
  );
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
