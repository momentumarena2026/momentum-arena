import { NextResponse } from "next/server";
import { rollupMetrics } from "@/lib/analytics-rollup";

/**
 * Hourly cron — rolls up the previous hour's events into MetricRollup.
 *
 * Scheduled from `vercel.json` at :30, with every other cron in this repo.
 *
 * It used to sit at :05, and the reason given was "the offset keeps it from
 * waking at the same instant as the other hourly crons". That reasoning was
 * backwards for what it actually costs. Neon bills COMPUTE TIME, and an idle
 * compute suspends only after 5 minutes without a query — so four crons on
 * four different minutes buy four five-minute awake windows an hour, while
 * four crons on the SAME minute buy one. Spreading them out was not polite,
 * it was paying four times over. Everything is on :30 now, which is also the
 * top of the IST hour (see daily-push for why that matters).
 *
 * It used to run from GitHub
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
