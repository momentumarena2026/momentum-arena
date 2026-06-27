import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import {
  adminCancelOrder,
  adminConfirmOrderPayment,
  adminMarkFulfilled,
} from "@/actions/shop-order";

/**
 * GET  /api/mobile/admin/product-orders/[id] — full order detail
 *      (items + customer + payment) for the mobile detail view.
 * POST /api/mobile/admin/product-orders/[id] — per-order admin action.
 *      body: { action: "confirm" | "fulfill" | "cancel", utrNumber?, reason? }
 *      Reuses the shared shop-order actions via adminOverride so the
 *      bearer-JWT identity is captured in the audit (confirmedById /
 *      fulfilledById). Money is returned in PAISE; client ÷100 for ₹.
 */
async function guard(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (admin.role !== "SUPERADMIN" && !hasPermission(admin.permissions ?? [], "MANAGE_SHOP_ORDERS")) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { admin };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard(request);
  if ("error" in g) return g.error;
  const { id } = await params;

  const order = await db.productOrder.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, phone: true, email: true } },
      items: { include: { product: { select: { imageUrl: true } } } },
      payment: true,
    },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    totalPaise: order.totalPaise,
    createdAt: order.createdAt.toISOString(),
    isPos: !!order.createdByAdminId,
    cancelReason: order.cancelReason,
    customer: {
      name: order.user?.name ?? null,
      phone: order.user?.phone ?? null,
      email: order.user?.email ?? null,
    },
    items: order.items.map((line) => ({
      id: line.id,
      name: line.nameSnapshot,
      priceEachPaise: line.priceEachPaise,
      quantity: line.quantity,
      imageUrl: line.product?.imageUrl ?? null,
    })),
    payment: order.payment
      ? {
          method: order.payment.method,
          status: order.payment.status,
          utrNumber: order.payment.utrNumber,
          razorpayPaymentId: order.payment.razorpayPaymentId,
        }
      : null,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard(request);
  if ("error" in g) return g.error;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const action = body?.action as string | undefined;
  const override = { id: g.admin.id, username: g.admin.username };

  let result: { success: boolean; error?: string };
  switch (action) {
    case "confirm":
      result = await adminConfirmOrderPayment(
        { orderId: id, utrNumber: body?.utrNumber || undefined },
        override,
      );
      break;
    case "fulfill":
      result = await adminMarkFulfilled(id, override);
      break;
    case "cancel": {
      const reason = (body?.reason as string | undefined)?.trim();
      if (!reason) {
        return NextResponse.json({ error: "A reason is required" }, { status: 400 });
      }
      result = await adminCancelOrder(id, reason, override);
      break;
    }
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  if (!result.success) {
    return NextResponse.json(
      { error: result.error ?? "Action failed" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
