import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import { enqueueReport, processNextQueuedReport } from "@/lib/reports/queue";

/**
 * Mobile admin reports. Mirrors app/api/admin/reports/route.ts but with bearer
 * auth: GET lists recent reports (all admins'), POST enqueues a job and drains
 * the queue inline via after() — exactly like the web route. Under
 * VIEW_ANALYTICS. The generated XLSX itself is downloaded from the web admin
 * (mobile can't save files without a native module).
 */
async function guard(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (
    admin.role !== "SUPERADMIN" &&
    !hasPermission(admin.permissions ?? [], "VIEW_ANALYTICS")
  ) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { admin };
}

export async function GET(request: NextRequest) {
  const g = await guard(request);
  if ("error" in g) return g.error;

  const limit = Math.min(
    Math.max(parseInt(new URL(request.url).searchParams.get("limit") ?? "30", 10), 1),
    100,
  );
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
  ]),
  year: z.number().int().min(2024).max(2100),
  month: z.number().int().min(1).max(12),
});

export async function POST(request: NextRequest) {
  const g = await guard(request);
  if ("error" in g) return g.error;

  const parsed = enqueueBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  const result = await enqueueReport({ ...parsed.data, requestedById: g.admin.id });
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  // Drain the queue inline (same rationale as the web route — cron drift).
  after(async () => {
    try {
      await processNextQueuedReport();
    } catch (err) {
      console.error("[reports] inline drain failed:", err);
    }
  });
  return NextResponse.json({ success: true });
}
