import { NextRequest, NextResponse } from "next/server";
import { getMobileUser } from "@/lib/mobile-auth";
import { db } from "@/lib/db";

/**
 * Cafe order detail for the signed-in mobile customer. Refuses if
 * the order belongs to someone else.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const order = await db.cafeOrder.findUnique({
    where: { id },
    include: {
      items: {
        select: {
          id: true,
          itemName: true,
          quantity: true,
          unitPrice: true,
          totalPrice: true,
          cafeItem: { select: { isVeg: true } },
        },
      },
      payment: true,
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      totalAmount: order.totalAmount,
      originalAmount: order.originalAmount,
      discountAmount: order.discountAmount,
      note: order.note,
      createdAt: order.createdAt.toISOString(),
      items: order.items.map((it) => ({
        id: it.id,
        itemName: it.itemName,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        totalPrice: it.totalPrice,
        isVeg: it.cafeItem?.isVeg ?? true,
      })),
      payment: order.payment
        ? {
            method: order.payment.method,
            status: order.payment.status,
            amount: order.payment.amount,
            confirmedAt: order.payment.confirmedAt?.toISOString() ?? null,
          }
        : null,
    },
  });
}
