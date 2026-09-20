import { NextResponse } from "next/server";
import { rollupMetrics } from "@/lib/analytics-rollup";

/**
 * Hourly cron — rolls up the previous hour's events into MetricRollup.
 *
 * Scheduled from `vercel.json` at :05 — the offset keeps it from waking at
 * the same instant as the other hourly crons. It used to run from GitHub
 * Actions because Vercel Hobby capped cron expressions at once per day; that
 * workaround outlived the Hobby plan, and GitHub was delivering 7 runs a day
 * against an hourly schedule, which the two-hour catch-up below could not
 * cover — the gaps reached five hours.
 *
 * Auth: Bearer CRON_SECRET, refused when unset rather than run open.
 *
 * Idempotent — safe to retry. The rollup writer deletes-then-inserts
 * the buckets it touches in a single transaction.
 */

// A rollup over two hours of events. The 60s default is tight on a busy day.
export const maxDuration = 300;
async function handle(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2 hours back gives automatic catch-up if a run is skipped. On an hourly
  // schedule that covers one missed run; it never covered GitHub's gaps.
  const result = await rollupMetrics({ hoursBack: 2 });

  return NextResponse.json(result);
}

export const GET = handle;
export const POST = handle;
