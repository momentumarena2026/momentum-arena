import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { getCalendarData } from "@/actions/admin-calendar";

/**
 * GET /api/mobile/admin/calendar?date=YYYY-MM-DD&sport=CRICKET
 *
 * Thin wrapper over the existing `getCalendarData` server action so
 * the mobile RN view can render the same court×hour grid the web
 * /admin/calendar page does. Sport filter is optional (all courts
 * when omitted).
 *
 * Auth is enforced twice on purpose: `requireMobileAdmin` here so a
 * bad caller gets a proper 401/403 JSON response, and the action's own
 * `requireAdmin("MANAGE_BOOKINGS")`, which resolves the mobile Bearer
 * JWT from the in-process request.
 */
export async function GET(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_BOOKINGS");
  if ("error" in gate) return gate.error;

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  const sport = searchParams.get("sport") || undefined;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "date (YYYY-MM-DD) required" },
      { status: 400 },
    );
  }

  try {
    const data = await getCalendarData(date, sport);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to load calendar",
      },
      { status: 500 },
    );
  }
}
