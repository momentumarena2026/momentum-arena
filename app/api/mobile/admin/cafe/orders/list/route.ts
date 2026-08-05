import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { getCafeOrders } from "@/actions/admin-cafe-orders";
import type { CafeOrderStatus } from "@prisma/client";

/**
 * GET /api/mobile/admin/cafe/orders/list?date=&status=&search=&page=
 *
 * Paginated order HISTORY — the app only had the live kanban
 * (/orders/live), so staff could work the queue but never look an
 * earlier order up. Same action, filters and page size as the web
 * /admin/cafe-orders list, so the two stay in step.
 */
export async function GET(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_CAFE_ORDERS");
  if ("error" in gate) return gate.error;

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status") || undefined;
  const { orders, total, totalPages } = await getCafeOrders({
    date: url.searchParams.get("date") || undefined,
    status: (statusParam as CafeOrderStatus) || undefined,
    search: url.searchParams.get("search") || undefined,
    page: Number.parseInt(url.searchParams.get("page") || "1", 10) || 1,
  });

  return NextResponse.json({
    total,
    totalPages,
    orders: orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      totalAmount: o.totalAmount,
      createdAt: o.createdAt.toISOString(),
      note: o.note,
      guestName: o.guestName,
      guestPhone: o.guestPhone,
      // Payment lives on the related row, not the order.
      paymentMethod: o.payment?.method ?? null,
      paymentStatus: o.payment?.status ?? null,
      user: o.user
        ? { id: o.user.id, name: o.user.name, phone: o.user.phone }
        : null,
      items: o.items.map((i) => ({
        id: i.id,
        quantity: i.quantity,
        itemName: i.itemName,
        unitPrice: i.unitPrice,
      })),
    })),
  });
}
