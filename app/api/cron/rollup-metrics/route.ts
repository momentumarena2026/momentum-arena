import { NextResponse } from "next/server";
import { rollupMetrics } from "@/lib/analytics-rollup";

/**
 * Hourly cron — rolls up the previous hour's events into MetricRollup.
 *
 * Auth: matches the existing send-reminders pattern — Bearer
 * CRON_SECRET. Same secret used by Vercel cron + GH Actions cron.
 *
 * Idempotent — safe to retry. The rollup writer deletes-then-inserts
 * the buckets it touches in a single transaction.
 */
async function handle(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2 hours back gives us automatic catch-up if a previous run was
  // skipped (GH Actions sometimes delays scheduled jobs).
  const result = await rollupMetrics({ hoursBack: 2 });

  return NextResponse.json(result);
}

export const GET = handle;
export const POST = handle;
