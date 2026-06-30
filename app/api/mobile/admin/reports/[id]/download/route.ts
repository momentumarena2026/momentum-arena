import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/lib/db";

/**
 * GET /api/mobile/admin/reports/[id]/download
 *
 * Bearer-authed equivalent of the web /api/admin/reports/[id]/download —
 * streams the generated XLSX bytes so the mobile app can download the
 * file (via expo-file-system) and hand it to the OS share / "open with"
 * sheet (expo-sharing). Gated on VIEW_ANALYTICS, same as the web route.
 *   404 unknown · 410 EXPIRED (bytes purged at 90d) · 409 not READY.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const { id } = await params;
  const row = await db.report.findUnique({
    where: { id },
    select: {
      status: true,
      filename: true,
      fileBytes: true,
      fileSizeBytes: true,
    },
  });
  if (!row) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }
  if (row.status === "EXPIRED") {
    return NextResponse.json(
      { error: "Report bytes have expired (>90 days). Re-request to regenerate." },
      { status: 410 },
    );
  }
  if (row.status !== "READY" || !row.fileBytes || !row.filename) {
    return NextResponse.json(
      { error: `Report is not ready yet (status: ${row.status})` },
      { status: 409 },
    );
  }

  return new NextResponse(new Uint8Array(row.fileBytes), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${row.filename}"`,
      "Content-Length": String(row.fileSizeBytes ?? row.fileBytes.length),
    },
  });
}
