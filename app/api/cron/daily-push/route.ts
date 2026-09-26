import { NextResponse } from "next/server";
import { runDailyPush } from "@/lib/daily-push";

/**
 * Cron worker — the daily push.
 *
 * ── THE HALF HOUR IS LOAD-BEARING ─────────────────────────────────────
 * Scheduled at `30 * * * *`, and the :30 is not a preference. Vercel
 * crons run in UTC; IST is UTC+5:30. A cron at `0 * * * *` therefore
 * fires at THIRTY MINUTES PAST every IST hour, so an admin who picks
 * "19:00" in the dashboard would get a 19:30 send with nothing in the UI
 * admitting it. `30 * * * *` UTC lands exactly on the IST hour, which is
 * what makes the hour picker honest.
 *
 * Anyone changing this schedule: the handler compares the IST hour to
 * the configured send hour and returns early otherwise, so a schedule
 * that does not align to the IST hour does not send late — it sends at
 * the wrong time or, if it never aligns, never at all.
 * ──────────────────────────────────────────────────────────────────────
 *
 * Fires hourly and does nothing 23 times out of 24. That is deliberate:
 * the alternative is encoding the send time in the cron expression,
 * which makes changing it a code change and a deploy rather than a
 * toggle in admin.
 *
 * Safe to miss an hour in a way `send-reminders` is not — a nudge that
 * did not go out is a nudge nobody was waiting for. There is no catch-up
 * pass, and there should not be one: a "free slots tonight" message
 * delivered at midnight is worse than no message.
 */

// The run reads availability once per active court and may fan out to
// several hundred devices. The platform default of 60s is not enough.
export const maxDuration = 300;

// Vercel cron fires via GET; POST is accepted so a manual curl works
// during operations.
async function handle(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  // Refuses on a missing secret rather than running open. This endpoint
  // pushes to every customer device in the fleet — an unauthenticated
  // trigger is a spam button.
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runDailyPush();

  return NextResponse.json({ ...result, timestamp: new Date().toISOString() });
}

export const GET = handle;
export const POST = handle;
