import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { updateCafeItem, deleteCafeItem } from "@/actions/admin-cafe";
import type { CafeItemCategory } from "@prisma/client";

const CATEGORIES: CafeItemCategory[] = [
  "SNACKS",
  "BEVERAGES",
  "MEALS",
  "DESSERTS",
  "COMBOS",
];

/**
 * PATCH /api/mobile/admin/cafe/items/[id]
 *
 * Edits a cafe menu item — mirrors the web edit form. Only fields
 * present in the body are updated. `quantity` doubles as the PREP vs
 * READY switch: null = kitchen-prepared (PREP, untracked stock), an
 * integer = ready-to-serve (READY, on-hand count). `costPrice: null`
 * clears a previously-set cost.
 *
 * Auth: requireMobileAdmin re-enforces MANAGE_CAFE_MENU; the web
 * action runs with skipAuth=true (NextAuth web-cookie bypass), the
 * same convention as the items list + availability routes.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileAdmin(request, "MANAGE_CAFE_MENU");
  if ("error" in gate) return gate.error;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const data: Parameters<typeof updateCafeItem>[1] = {};
  if (b.name !== undefined) data.name = String(b.name);
  if (b.description !== undefined)
    data.description = b.description === null ? null : String(b.description);
  if (b.category !== undefined) {
    if (!CATEGORIES.includes(b.category as CafeItemCategory)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }
    data.category = b.category as CafeItemCategory;
  }
  if (b.price !== undefined) {
    const priceNum = Number(b.price);
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      return NextResponse.json({ error: "Price must be positive" }, { status: 400 });
    }
    data.price = priceNum;
  }
  if (b.costPrice !== undefined)
    data.costPrice =
      b.costPrice === null || b.costPrice === "" ? null : Number(b.costPrice);
  if (b.quantity !== undefined)
    data.quantity = b.quantity === null ? null : Math.trunc(Number(b.quantity));
  if (b.isVeg !== undefined) data.isVeg = !!b.isVeg;
  if (b.tags !== undefined)
    data.tags = Array.isArray(b.tags) ? b.tags.map((t) => String(t)) : [];

  const result = await updateCafeItem(id, data, true);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/mobile/admin/cafe/items/[id]
 *
 * Soft-deletes the item (web action flips isAvailable=false rather
 * than hard-deleting, to keep historical order lines intact).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileAdmin(request, "MANAGE_CAFE_MENU");
  if ("error" in gate) return gate.error;

  const { id } = await params;
  const result = await deleteCafeItem(id, true);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
