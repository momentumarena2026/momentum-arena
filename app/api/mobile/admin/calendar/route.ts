import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { getCalendarData } from "@/actions/admin-calendar";

/**
 * GET /api/mobile/admin/calendar?date=YYYY-MM-DD&sport=CRICKET
 *
 * Thin wrapper over the existing `getCalendarData` server action so
 * the mobile RN view can render the same court×hour grid the web
 * /admin/calendar page does. Sport filter is optional (all courts
 * when omitted).
 *
 * `skipAuth: true` is safe here because we've already verified the
 * admin JWT above — the action's own `requireAdmin` cookie check
 * would otherwise fail for mobile callers.
 */
export async function GET(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    const data = await getCalendarData(date, sport, true);
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
