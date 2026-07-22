import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import { getFunnel, getInsightsOverview } from "@/actions/admin-insights";
import { FUNNELS, type FunnelKey } from "@/lib/analytics-funnels";

/**
 * GET /api/mobile/admin/analytics/funnels?key=booking&from=&to=
 *
 * Returns one predefined funnel (step counts + conversion %) plus the
 * overview KPIs for the same window, so the screen can render both
 * with a single request. `key` must be one of the FUNNELS keys.
 * Requires VIEW_ANALYTICS (or SUPERADMIN).
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
  const key = sp.get("key") ?? "booking";
  const from = sp.get("from");
  const to = sp.get("to");

  if (!(key in FUNNELS)) {
    return NextResponse.json(
      { error: `Unknown funnel "${key}"` },
      { status: 400 },
    );
  }
  if (!from || !to) {
    return NextResponse.json(
      { error: "from and to are required (YYYY-MM-DD)" },
      { status: 400 },
    );
  }

  const [funnel, overview] = await Promise.all([
    getFunnel(key as FunnelKey, from, to),
    getInsightsOverview(from, to),
  ]);

  return NextResponse.json({ funnel, overview });
}
