import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/lib/admin-auth-session";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { enqueueReport, processNextQueuedReport } from "@/lib/reports/queue";

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
  type: z.enum([
    "SALES_MONTHLY",
    "RAZORPAY_RECON_MONTHLY",
    "CA_MONTHLY",
    "EXPENSES_MONTHLY",
    "EXPENSES_LIFETIME",
    "REWARD_LIABILITY_MONTHLY",
    "REWARD_LIABILITY_LIFETIME",
    "REWARD_ALERTS_MONTHLY",
    "REWARD_TXN_LEDGER_MONTHLY",
    "REWARD_TXN_LEDGER_LIFETIME",
    "CAFE_INVENTORY_MONTHLY",
    "CAFE_INVENTORY_LIFETIME",
    "CAFE_ITEM_SALES_MONTHLY",
  ]),
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

  // Drain the queue right after responding. The cron-process-reports
  // workflow is supposed to fire every minute but GitHub Actions
  // schedule reliability on the free tier is poor (hours of drift,
  // sometimes "active but never run"), so we kick off the worker
  // inline. Vercel's after() keeps the function alive until the
  // promise resolves (or hits the platform max-duration limit), and
  // the response has already been streamed so the admin sees
  // "Queued" instantly. The page's 4s poll then picks up the
  // "Ready" status the moment the worker writes it.
  //
  // The cron stays in place as a safety net for stuck-state recovery
  // (e.g. if a worker dies mid-process before flipping the row to
  // READY/FAILED — see processNextQueuedReport for the recovery).
  after(async () => {
    try {
      await processNextQueuedReport();
    } catch (err) {
      console.error("[reports] inline drain failed:", err);
    }
  });

  return NextResponse.json({ success: true, report: result.report });
}
