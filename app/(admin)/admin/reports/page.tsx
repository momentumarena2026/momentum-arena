import { db } from "@/lib/db";
import { ReportsClient, type ReportRow } from "./reports-client";

export const dynamic = "force-dynamic";

/**
 * /admin/reports — async report generation queue.
 *
 * Permission: VIEW_ANALYTICS (already enforced by the (admin)
 * layout's nav-item gate; both API routes re-check the same
 * permission).
 *
 * The page is a thin server-render wrapper around the client
 * component, which owns the polling + form. We seed the initial
 * list server-side so admins don't see a "loading…" flash on
 * cold load.
 */
export default async function ReportsPage() {
  const rows = await db.report.findMany({
    orderBy: { createdAt: "desc" },
    take: 30,
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

  const initial: ReportRow[] = rows.map((r) => ({
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
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Reports</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Queue monthly reports here — they generate one at a time in
          the background, and become downloadable as soon as they&apos;re
          ready. Bytes are kept for 90 days.
        </p>
      </div>

      <ReportsClient initialReports={initial} />
    </div>
  );
}
