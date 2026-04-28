import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { getCafeOrderStats } from "@/actions/admin-cafe-orders";

/**
 * GET /api/mobile/admin/cafe/orders/stats
 *
 * Today's at-a-glance numbers for the cafe screen: order count,
 * revenue, pending count, top-5 popular items. Mirrors the strip the
 * web /admin/cafe-orders page shows above its kanban.
 */
export async function GET(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stats = await getCafeOrderStats(true);
  return NextResponse.json(stats);
}
