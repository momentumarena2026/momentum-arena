import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import { createCustomerForBooking } from "@/actions/admin-booking";
import { placeAdminOrder } from "@/actions/shop-order";
import type { PaymentMethod } from "@prisma/client";

/**
 * GET  /api/mobile/admin/pos — in-stock products for the walk-in picker.
 *      Mirrors the web POS page query: isActive + stockQuantity > 0.
 * POST /api/mobile/admin/pos — ring up a walk-in sale.
 *      body: {
 *        items: { productId, quantity }[],
 *        customerPhone, customerName,   // resolved to a User (idempotent on phone)
 *        method: "CASH" | "UPI_QR",
 *        markPaid?: boolean,            // mark order CONFIRMED + payment COMPLETED
 *        utrNumber?: string,
 *      }
 *      Reuses placeAdminOrder so the full web logic (atomic stock
 *      decrement, snapshots, audit) is shared. That action resolves the
 *      admin from this request's Bearer JWT itself. Money in PAISE.
 */
async function guard(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (admin.role !== "SUPERADMIN" && !hasPermission(admin.permissions ?? [], "MANAGE_SHOP_ORDERS")) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { admin };
}

export async function GET(request: NextRequest) {
  const g = await guard(request);
  if ("error" in g) return g.error;

  const products = await db.product.findMany({
    where: { isActive: true, stockQuantity: { gt: 0 } },
    include: { category: { select: { name: true } } },
    orderBy: [
      { category: { displayOrder: "asc" } },
      { displayOrder: "asc" },
      { createdAt: "desc" },
    ],
  });

  return NextResponse.json({
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      pricePaise: p.pricePaise,
      stockQuantity: p.stockQuantity,
      imageUrl: p.imageUrl,
      categoryName: p.category?.name ?? null,
    })),
  });
}

export async function POST(request: NextRequest) {
  const g = await guard(request);
  if ("error" in g) return g.error;

  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "Add at least one item" }, { status: 400 });
  }
  const phone = (body.customerPhone as string | undefined)?.trim();
  const name = (body.customerName as string | undefined)?.trim();
  if (!phone || !name) {
    return NextResponse.json(
      { error: "Customer name and phone are required" },
      { status: 400 },
    );
  }

  // Resolve (or create) the customer — idempotent on phone, same path
  // the web POS uses via createCustomerForBooking. The action runs its
  // own admin gate, resolving this request's Bearer JWT; `guard` above
  // stays so an unauthorized call gets a 401/403 instead of a 500.
  const cust = await createCustomerForBooking({ name, phone });
  if (!cust.success) {
    return NextResponse.json(
      { error: cust.error ?? "Could not resolve customer" },
      { status: 400 },
    );
  }

  const method = (body.method ?? "CASH") as PaymentMethod;
  const result = await placeAdminOrder(
    {
      customerUserId: cust.userId,
      items: body.items.map((i: { productId: string; quantity: number }) => ({
        productId: i.productId,
        quantity: i.quantity,
      })),
      method,
      markPaid: body.markPaid !== false,
      utrNumber:
        method === "UPI_QR" && body.utrNumber ? String(body.utrNumber).trim() : undefined,
    },
  );

  if (!result.success || !result.orderId) {
    return NextResponse.json(
      { error: result.error ?? "Order failed" },
      { status: 400 },
    );
  }
  return NextResponse.json({
    ok: true,
    orderId: result.orderId,
    orderNumber: result.orderNumber,
  });
}
