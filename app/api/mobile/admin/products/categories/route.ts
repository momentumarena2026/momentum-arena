import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";

/**
 * Mobile admin product categories. Mirrors listProductCategories /
 * createProductCategory in actions/admin-products.ts. Those server actions
 * gate on the web session (requireCatalogAdmin), which mobile's bearer auth
 * can't satisfy, so we re-enforce MANAGE_SHOP_CATALOG here and run the same
 * Prisma writes directly. GET returns ALL categories (active + inactive) so
 * the admin can manage them; the customer shop filters on isActive elsewhere.
 */
export async function GET(request: NextRequest) {
  const g = await requireMobileAdmin(request, "MANAGE_SHOP_CATALOG");
  if ("error" in g) return g.error;

  const categories = await db.productCategory.findMany({
    orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }],
    include: { _count: { select: { products: true } } },
  });
  return NextResponse.json({ categories });
}

export async function POST(request: NextRequest) {
  const g = await requireMobileAdmin(request, "MANAGE_SHOP_CATALOG");
  if ("error" in g) return g.error;

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Category name is required" }, { status: 400 });
  }
  const displayOrder =
    body?.displayOrder != null ? Math.trunc(Number(body.displayOrder)) || 0 : 0;

  const category = await db.productCategory.create({
    data: { name, displayOrder },
  });
  return NextResponse.json({ ok: true, category });
}
