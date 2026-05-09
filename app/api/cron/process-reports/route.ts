import { NextResponse } from "next/server";
import { processNextQueuedReport } from "@/lib/reports/queue";

/**
 * Cron worker — drains the report queue. GH Actions fires this
 * once a minute (cron-process-reports.yml); Vercel daily acts as a
 * safety-net backup (vercel.json).
 *
 * On each fire we drain UP TO `MAX_PER_FIRE` reports so a flurry
 * of requests gets cleared in a single tick rather than spreading
 * across multiple minutes. Each individual report runs sub-second
 * to a few seconds so the loop's bounded.
 *
 * Auth: same Bearer CRON_SECRET pattern as the other crons.
 */

const MAX_PER_FIRE = 5;

async function handle(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = [];
  for (let i = 0; i < MAX_PER_FIRE; i++) {
    const r = await processNextQueuedReport();
    if (!r.processed) break;
    results.push({
      reportId: r.reportId,
      status: r.status,
      durationMs: r.durationMs,
      error: r.error,
    });
  }

  return NextResponse.json({
    processed: results.length,
    results,
    timestamp: new Date().toISOString(),
  });
}

export const GET = handle;
export const POST = handle;
