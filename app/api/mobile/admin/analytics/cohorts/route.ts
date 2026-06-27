import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import { getCohortRetention } from "@/actions/admin-insights";

/**
 * GET /api/mobile/admin/analytics/cohorts?weeks=8
 *
 * Week-on-week retention grid. `weeks` (1–26, default 8) controls how
 * many cohorts and follow-up weeks are computed. Requires
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

  const raw = new URL(request.url).searchParams.get("weeks");
  const parsed = raw ? Number.parseInt(raw, 10) : 8;
  const weeks = Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 1), 26)
    : 8;

  const data = await getCohortRetention(weeks, true);
  return NextResponse.json(data);
}
