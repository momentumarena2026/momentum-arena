import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/admin-auth-session";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/lib/db";

/**
 * GET /api/admin/reports/[id]/download
 *
 * Streams the generated XLSX bytes back as a file attachment. 404
 * for unknown id, 409 for any non-READY status, 410 for EXPIRED
 * (rows kept for audit but bytes purged at 90d retention).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await adminAuth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const u = session.user as unknown as { permissions?: string[] };
  if (!hasPermission(u.permissions ?? [], "VIEW_ANALYTICS")) {
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

  // Prisma returns Bytes as a Buffer in Node — pass straight through.
  // Setting Content-Length lets the browser show a download progress bar.
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
