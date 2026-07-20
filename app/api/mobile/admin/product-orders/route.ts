import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import {
  getShopAnalyticsSummary,
  listOrdersForAdmin,
} from "@/actions/shop-order";
import type { ProductOrderStatus } from "@prisma/client";

/**
 * GET /api/mobile/admin/product-orders?status=&q=&page=
 *
 * Mirrors the web /admin/product-orders list. Reuses listOrdersForAdmin plus
 * the shop analytics roll-up — those actions resolve the bearer-JWT identity
 * themselves via requireAdmin, so nothing is threaded through from here. The
 * guard below stays as this route's boundary (proper 401/403 JSON).
 * Money is returned in PAISE — the client divides by 100 for ₹ display.
 */
async function guard(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (admin.role !== "SUPERADMIN" && !hasPermission(admin.permissions ?? [], "MANAGE_SHOP_ORDERS")) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { admin };
}

const STATUSES: ProductOrderStatus[] = [
  "PENDING",
  "CONFIRMED",
  "FULFILLED",
  "CANCELLED",
  "REFUNDED",
];

export async function GET(request: NextRequest) {
  const g = await guard(request);
  if ("error" in g) return g.error;

  const sp = new URL(request.url).searchParams;
  const statusRaw = sp.get("status");
  const status =
    statusRaw && STATUSES.includes(statusRaw as ProductOrderStatus)
      ? (statusRaw as ProductOrderStatus)
      : undefined;
  const search = sp.get("q")?.trim() || undefined;
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);

  const [{ orders, total, totalPages }, summary] = await Promise.all([
    listOrdersForAdmin({ status, search, page }),
    getShopAnalyticsSummary(),
  ]);

  return NextResponse.json({
    orders: orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      totalPaise: o.totalPaise,
      createdAt: o.createdAt.toISOString(),
      isPos: !!o.createdByAdminId,
      itemCount: o.items.reduce((s, i) => s + i.quantity, 0),
      customer: { name: o.user?.name ?? null, phone: o.user?.phone ?? null },
      payment: o.payment
        ? { method: o.payment.method, status: o.payment.status }
        : null,
    })),
    total,
    page,
    totalPages,
    summary: {
      orderCount: summary.orderCount,
      revenuePaise: summary.revenuePaise,
      costPaise: summary.costPaise,
      profitPaise: summary.profitPaise,
      marginPct: summary.marginPct,
    },
  });
}
