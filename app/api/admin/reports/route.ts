import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/lib/admin-auth-session";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { enqueueReport } from "@/lib/reports/queue";

const PERMISSION = "VIEW_ANALYTICS" as const;

/**
 * Admin-side reports API.
 *
 * GET  /api/admin/reports        — list (most recent first, paginated)
 * POST /api/admin/reports        — enqueue a new report job
 *
 * Both gated on the VIEW_ANALYTICS permission, same as the
 * (now-removed) direct-download route they replace.
 */

async function gate() {
  const session = await adminAuth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const u = session.user as unknown as { id: string; permissions?: string[] };
  if (!hasPermission(u.permissions ?? [], PERMISSION)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { adminId: u.id };
}

export async function GET(request: NextRequest) {
  const gated = await gate();
  if ("error" in gated) return gated.error;

  const limit = Math.min(
    Math.max(
      parseInt(request.nextUrl.searchParams.get("limit") ?? "30", 10),
      1,
    ),
    100,
  );

  // Show ALL reports across the team — admins should see other
  // admins' queued/ready reports too (e.g. so the same monthly
  // report doesn't get re-requested while it's still GENERATING).
  // The requestedBy.username is included so the admin reading the
  // table can see who asked for what.
  const rows = await db.report.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      type: true,
      status: true,
      year: true,
      month: true,
      filename: true,
      fileSizeBytes: true,
      errorMessage: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
      requestedBy: { select: { username: true } },
    },
  });

  return NextResponse.json({
    reports: rows.map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      year: r.year,
      month: r.month,
      filename: r.filename,
      fileSizeBytes: r.fileSizeBytes,
      errorMessage: r.errorMessage,
      startedAt: r.startedAt?.toISOString() ?? null,
      completedAt: r.completedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      requestedByUsername: r.requestedBy.username,
    })),
  });
}

const enqueueBody = z.object({
  type: z.enum(["SALES_MONTHLY", "RAZORPAY_RECON_MONTHLY"]),
  year: z.number().int().min(2024).max(2100),
  month: z.number().int().min(1).max(12),
});

export async function POST(request: NextRequest) {
  const gated = await gate();
  if ("error" in gated) return gated.error;

  const json = await request.json().catch(() => null);
  const parsed = enqueueBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  const result = await enqueueReport({
    ...parsed.data,
    requestedById: gated.adminId,
  });
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ success: true, report: result.report });
}
