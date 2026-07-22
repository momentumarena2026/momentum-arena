import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import {
  updateProduct,
  deleteProduct,
  adjustProductStock,
} from "@/actions/admin-products";

/**
 * Mobile admin product edit/delete + stock adjust. Reuses updateProduct /
 * deleteProduct / adjustProductStock, which each resolve the acting admin
 * (and enforce MANAGE_SHOP_CATALOG) from the bearer token themselves. The
 * guard below stays for correct 401/403 status codes.
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard(request);
  if ("error" in g) return g.error;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  // Stock changes go through adjustProductStock for the audit trail.
  if (typeof body.stockDelta === "number" && body.stockDelta !== 0) {
    const r = await adjustProductStock(
      { productId: id, delta: Math.trunc(body.stockDelta), note: body.stockNote || "Mobile admin adjustment" },
    );
    if (!r.success) return NextResponse.json({ error: r.error }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = String(body.name);
  if (body.description !== undefined) data.description = body.description ?? null;
  if (body.pricePaise !== undefined) data.pricePaise = Math.trunc(Number(body.pricePaise));
  if (body.costPaise !== undefined) data.costPaise = Math.trunc(Number(body.costPaise));
  if (body.lowStockThreshold !== undefined)
    data.lowStockThreshold = Math.trunc(Number(body.lowStockThreshold));
  if (body.categoryId !== undefined) data.categoryId = body.categoryId || null;
  if (body.isActive !== undefined) data.isActive = !!body.isActive;

  if (Object.keys(data).length > 0) {
    const r = await updateProduct(id, data);
    if (!r.success) return NextResponse.json({ error: r.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard(request);
  if ("error" in g) return g.error;
  const { id } = await params;
  const r = await deleteProduct(id);
  if (!r.success) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
