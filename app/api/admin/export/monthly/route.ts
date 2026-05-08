import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/admin-auth-session";
import { hasPermission } from "@/lib/permissions";
import { exportMonthlyXlsx } from "@/lib/admin-export";

/**
 * GET /api/admin/export/monthly?year=2026&month=5
 *
 * Streams an .xlsx workbook with a Summary + Bookings + Cafe Orders
 * sheet for the requested IST month. Admin-cookie gated via the
 * same NextAuth session the admin layout uses; requires the
 * VIEW_ANALYTICS permission (matches the /admin/analytics page).
 */
export async function GET(request: NextRequest) {
  const session = await adminAuth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Type-safe permission check — same shape as the layout's nav-item
  // gate.
  const u = session.user as unknown as { permissions?: string[] };
  if (!hasPermission(u.permissions ?? [], "VIEW_ANALYTICS")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const yearRaw = request.nextUrl.searchParams.get("year");
  const monthRaw = request.nextUrl.searchParams.get("month");
  const year = yearRaw ? parseInt(yearRaw, 10) : NaN;
  const month = monthRaw ? parseInt(monthRaw, 10) : NaN;
  if (
    !Number.isFinite(year) ||
    year < 2020 ||
    year > 2100 ||
    !Number.isFinite(month) ||
    month < 1 ||
    month > 12
  ) {
    return NextResponse.json(
      { error: "Invalid year or month — pass year=YYYY&month=1..12" },
      { status: 400 },
    );
  }

  const { buffer, filename } = await exportMonthlyXlsx({ year, month });

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buffer.length),
      // Don't cache — the underlying booking/cafe data is mutable.
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
