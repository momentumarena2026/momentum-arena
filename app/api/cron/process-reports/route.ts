import { NextResponse } from "next/server";
import { processNextQueuedReport } from "@/lib/reports/queue";

/**
 * Cron worker — drains the report queue, every minute, from Vercel.
 *
 * It used to say GitHub fired this once a minute with "Vercel daily as a
 * safety-net backup". Both halves of that were untrue. GitHub honours a
 * `* * * * *` schedule as roughly **7 runs a day** — scheduled Actions are
 * best-effort and dropped under load — and the Vercel backup was never in
 * `vercel.json` at all. So an admin who asked for a report waited up to five
 * hours for something built to take a minute, with nothing behind it.
 *
 * The schedule now lives in `vercel.json`, which honours per-minute, and the
 * GitHub workflow is gone rather than left to look like a second layer of
 * protection it was not providing.
 *
 * On each fire we drain UP TO `MAX_PER_FIRE` reports so a flurry of requests
 * gets cleared in a single tick rather than spreading across minutes. Each
 * report runs sub-second to a few seconds, so the loop is bounded and short.
 *
 * ── WHY THIS IS HOURLY AND NOT EVERY MINUTE ──────────────────────────
 * It ran on a one-minute tick from 2026-09-21, on the reasoning that "this is a queue
 * an admin is actively waiting on". That reasoning does not survive contact
 * with the rest of the code: BOTH admin routes that enqueue a report already
 * drain it inline via `after(() => processNextQueuedReport())`, so the admin
 * never waits for this cron at all. Its own docstring said as much — "the
 * cron stays in place as a safety net for stuck-state recovery".
 *
 * So the minute schedule bought no latency. What it bought was 43,200 runs a
 * month, each one a WRITE (`db.report.updateMany`), against a queue that
 * handled TWO reports in thirty days — and, because Neon suspends an idle
 * compute only after five minutes, a production database that never slept.
 * That was most of a doubled Neon bill. A safety net for a worker that died
 * mid-row does not need to run every sixty seconds.
 *
 * Auth: Bearer CRON_SECRET, and it REFUSES when the secret is unset rather
 * than running open — reports can carry customer and revenue data, so an
 * environment that forgot to configure it should fail loudly.
 */

const MAX_PER_FIRE = 5;

// Five reports at a few seconds each, plus headroom for a cold start. The
// platform default of 60s would cut a busy drain off partway.
export const maxDuration = 120;

async function handle(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
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
