import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import { adminCreateCafeOrder } from "@/actions/admin-cafe-orders";
import type { PaymentMethod } from "@prisma/client";

/**
 * POST /api/mobile/admin/cafe/orders/create — admin rings up a cafe order
 * (walk-in or phone-first customer). Reuses adminCreateCafeOrder so the full
 * web logic (stock guard, split payment, customer-create, order-status
 * routing) is shared, not re-implemented. That action resolves the acting
 * admin from this request's own bearer token and re-checks
 * MANAGE_CAFE_ORDERS itself; the check below stays so an unauthorized
 * request gets a 401/403 instead of a thrown 500.
 */
export async function POST(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (
    admin.role !== "SUPERADMIN" &&
    !hasPermission(admin.permissions ?? [], "MANAGE_CAFE_ORDERS")
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json(
      { error: "At least one item is required" },
      { status: 400 },
    );
  }

  const result = await adminCreateCafeOrder({
    items: body.items,
    customerPhone: body.customerPhone,
    customerName: body.customerName,
    discountAmount: body.discountAmount,
    paymentMethod: (body.paymentMethod ?? "CASH") as PaymentMethod,
    split: body.split,
    collectLater: body.collectLater === true,
    note: body.note,
  });

  if (!result.success || !result.order) {
    return NextResponse.json(
      { error: result.error ?? "Failed to create order" },
      { status: 400 },
    );
  }
  return NextResponse.json({
    ok: true,
    orderId: result.order.id,
    orderNumber: result.order.orderNumber,
  });
}
