import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { getLiveCafeOrders } from "@/actions/admin-cafe-orders";

/**
 * GET /api/mobile/admin/cafe/orders/live
 *
 * Returns the kanban shape: { PENDING, PREPARING, READY } orders,
 * each ordered by createdAt ASC so the oldest in each lane sits
 * first. Trimmed to the fields the RN kanban actually renders so we
 * don't pay JSON-cost on every poll.
 */
export async function GET(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const grouped = await getLiveCafeOrders(true);

  function trim(o: (typeof grouped)["PENDING"][number]) {
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      totalAmount: o.totalAmount,
      createdAt: o.createdAt.toISOString(),
      note: o.note,
      guestName: o.guestName,
      guestPhone: o.guestPhone,
      user: o.user
        ? {
            id: o.user.id,
            name: o.user.name,
            phone: o.user.phone,
          }
        : null,
      items: o.items.map((i) => ({
        id: i.id,
        quantity: i.quantity,
        itemName: i.itemName,
        unitPrice: i.unitPrice,
        isVeg: i.cafeItem?.isVeg ?? null,
      })),
      payment: o.payment
        ? { status: o.payment.status, method: o.payment.method }
        : null,
    };
  }

  return NextResponse.json({
    PENDING: grouped.PENDING.map(trim),
    PREPARING: grouped.PREPARING.map(trim),
    READY: grouped.READY.map(trim),
  });
}
