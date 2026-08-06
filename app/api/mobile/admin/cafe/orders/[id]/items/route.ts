import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import {
  addItemsToCafeOrder,
  cancelItemsFromCafeOrder,
} from "@/actions/admin-cafe-orders";

/**
 * Edit an order's items from the app.
 *
 *   POST { op: "add",    items: [{ cafeItemId, quantity }] }
 *   POST { op: "cancel", orderItemIds: [...] }
 *
 * Both delegate to the actions the web admin uses, so the stock guard,
 * the total recalculation and the edit-history write happen in exactly
 * one implementation. Re-deriving any of that here is how the two
 * surfaces would start disagreeing about what an order costs.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getMobileAdmin(request);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (
    admin.role !== "SUPERADMIN" &&
    !hasPermission(admin.permissions ?? [], "MANAGE_CAFE_ORDERS")
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body?.op) return NextResponse.json({ error: "op is required" }, { status: 400 });

  let result;
  if (body.op === "add") {
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ error: "items is required" }, { status: 400 });
    }
    result = await addItemsToCafeOrder(id, body.items);
  } else if (body.op === "cancel") {
    if (!Array.isArray(body.orderItemIds) || body.orderItemIds.length === 0) {
      return NextResponse.json({ error: "orderItemIds is required" }, { status: 400 });
    }
    result = await cancelItemsFromCafeOrder(id, body.orderItemIds);
  } else {
    return NextResponse.json({ error: "Unknown op" }, { status: 400 });
  }

  if (result && (result as { success?: boolean }).success === false) {
    return NextResponse.json(
      { error: (result as { error?: string }).error || "Failed" },
      { status: 400 },
    );
  }
  return NextResponse.json({ success: true });
}
