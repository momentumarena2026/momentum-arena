import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import { getDemandHeatmap } from "@/actions/admin-insights";

/**
 * GET /api/mobile/admin/analytics/demand?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Day-of-week × hour × sport heatmap of unmet booking demand
 * (waitlist entries ∪ slot_unavailable_tap events). Sport filtering
 * happens client-side off the returned `cells`. Requires
 * VIEW_ANALYTICS (or SUPERADMIN).
 */
export async function GET(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (
    admin.role !== "SUPERADMIN" &&
    !hasPermission(admin.permissions ?? [], "VIEW_ANALYTICS")
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sp = new URL(request.url).searchParams;
  const from = sp.get("from");
  const to = sp.get("to");
  if (!from || !to) {
    return NextResponse.json(
      { error: "from and to are required (YYYY-MM-DD)" },
      { status: 400 },
    );
  }

  const data = await getDemandHeatmap(from, to);
  return NextResponse.json(data);
}
