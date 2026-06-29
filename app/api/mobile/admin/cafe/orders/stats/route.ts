import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { getCafeOrderStats } from "@/actions/admin-cafe-orders";

/**
 * GET /api/mobile/admin/cafe/orders/stats
 *
 * Today's at-a-glance numbers for the cafe screen: order count,
 * revenue, pending count, top-5 popular items. Mirrors the strip the
 * web /admin/cafe-orders page shows above its kanban.
 */
export async function GET(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_CAFE_ORDERS");
  if ("error" in gate) return gate.error;

  const stats = await getCafeOrderStats(true);
  return NextResponse.json(stats);
}
