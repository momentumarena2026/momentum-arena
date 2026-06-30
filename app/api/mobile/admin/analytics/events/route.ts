import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import {
  listAnalyticsEvents,
  listEventNames,
  listServerActionLogs,
  listServerActionNames,
} from "@/actions/admin-insights";
import { AnalyticsCategory } from "@prisma/client";

/**
 * GET /api/mobile/admin/analytics/events?tab=client|server&...
 *
 * Backs the two tabs of the Events & logs screen:
 *  - tab=client → AnalyticsEvent rows (client-emitted events)
 *  - tab=server → ServerActionLog rows (server action audit log)
 *
 * Shared filters: name/action, category, outcome (server only),
 * userId, sessionId (client only), before (cursor), limit.
 *
 * With `names=1`, returns the distinct name list used to populate the
 * filter dropdown instead of a page of rows:
 *  - tab=client → distinct AnalyticsEvent names (last 30 days)
 *  - tab=server → distinct ServerActionLog action names (all time)
 * shaped as { names: string[] }.
 *
 * Returns the matching list result ({ rows, hasMore, nextCursor }).
 * Requires VIEW_ANALYTICS (or SUPERADMIN). This route auth-checks, so
 * the underlying actions are called with skipAuth=true.
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
  const tab = sp.get("tab") === "server" ? "server" : "client";

  // Distinct-name list mode — powers the Event name / Action filter.
  if (sp.get("names") === "1") {
    const names =
      tab === "server"
        ? await listServerActionNames(true)
        : await listEventNames(true);
    return NextResponse.json({ names });
  }

  const before = sp.get("before") || undefined;
  const limitRaw = sp.get("limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  const category = sp.get("category") || undefined;

  if (tab === "server") {
    const data = await listServerActionLogs(
      {
        action: sp.get("name") || undefined,
        category:
          category && category in AnalyticsCategory
            ? (category as AnalyticsCategory)
            : undefined,
        outcome: sp.get("outcome") || undefined,
        userId: sp.get("userId") || undefined,
        before,
        limit,
      },
      true,
    );
    return NextResponse.json(data);
  }

  const data = await listAnalyticsEvents(
    {
      name: sp.get("name") || undefined,
      category,
      userId: sp.get("userId") || undefined,
      sessionId: sp.get("sessionId") || undefined,
      before,
      limit,
    },
    true,
  );
  return NextResponse.json(data);
}
