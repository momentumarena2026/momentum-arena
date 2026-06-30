import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import {
  getPushAnalytics,
  getDispatchedKinds,
} from "@/actions/admin-push-analytics";

/**
 * GET /api/mobile/admin/analytics/push?from=&to=&kinds=&sources=&scope=
 *
 * Push KPI dashboard backing AdminPushAnalyticsScreen. Mirrors the web
 * /admin/analytics/push page: default range is "earliest dispatch →
 * today" so lifetime send totals match out of the box; falls back to the
 * last 30 days before the dispatch log has any rows. Pass ?from / ?to
 * (YYYY-MM-DD) to narrow the window, plus the same dispatch filters the
 * web dashboard exposes:
 *   - kinds   : comma-separated dispatch kinds (omit for all)
 *   - sources : comma-separated of event | broadcast | test (omit for all)
 *   - scope   : customer | admin (omit / "all" for both)
 *
 * Returns { analytics: PushAnalytics, kinds: string[] }. Send metrics
 * (totals, byKind, bySource, timeSeries, recent) build up from the
 * dispatch log's first write; fleet metrics are full history.
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
  const now = new Date();
  const dateTo = sp.get("to") || now.toISOString().split("T")[0];

  let dateFrom = sp.get("from") || undefined;
  if (!dateFrom) {
    // Default range = earliest dispatch → today, matching the web push
    // page. Falls back to last 30 days when the log is still empty.
    const earliest = await db.pushDispatch.findFirst({
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    dateFrom = earliest?.createdAt
      ? earliest.createdAt.toISOString().split("T")[0]
      : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0];
  }

  // Optional dispatch filters — comma-separated lists for kinds/sources,
  // a single value for scope. Mirrors the web dashboard's filter chips.
  const csv = (key: string): string[] | undefined => {
    const raw = sp.get(key);
    if (!raw) return undefined;
    const parts = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length ? parts : undefined;
  };
  const scopeRaw = sp.get("scope");
  const scope =
    scopeRaw === "customer" || scopeRaw === "admin" ? scopeRaw : undefined;

  const [analytics, kinds] = await Promise.all([
    getPushAnalytics(
      {
        dateFrom,
        dateTo,
        kinds: csv("kinds"),
        sources: csv("sources"),
        scope,
      },
      true,
    ),
    getDispatchedKinds(true),
  ]);

  return NextResponse.json({ analytics, kinds });
}
