import { NextResponse } from "next/server";
import { runRegDrives } from "@/lib/tournament-reg-drive-engine";

/**
 * Cron worker — the tournament registration drive.
 *
 * ── THE HALF HOUR IS LOAD-BEARING ─────────────────────────────────────
 * Scheduled at `30 * * * *`, same as the daily push and for the same
 * reason: Vercel crons run in UTC and IST is UTC+5:30, so `0 * * * *`
 * would fire at THIRTY MINUTES PAST every IST hour and a tournament set
 * to 19:00 would send at 19:30 with nothing in the UI admitting it.
 * `30 * * * *` UTC lands exactly on the IST hour.
 * ──────────────────────────────────────────────────────────────────────
 *
 * Fires hourly and does nothing 23 times out of 24 per tournament. The
 * send hour is per-tournament, so two tournaments can legitimately want
 * different hours and the handler cannot return early on a global one —
 * driveRefusal does that check per tournament instead.
 *
 * Safe to miss an hour: a registration nudge that did not go out is a
 * nudge nobody was waiting for, and there is deliberately no catch-up
 * pass. Sending yesterday's "2 days left" today would be worse than
 * silence.
 */

// Counts teams and reads the device fleet per open tournament, then may
// fan out to several hundred devices. The platform default of 60s is
// not enough.
export const maxDuration = 300;

async function handle(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  // Refuses on a missing secret rather than running open. This endpoint
  // pushes to customer devices — an unauthenticated trigger is a spam
  // button.
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runRegDrives();
  return NextResponse.json({ ...result, timestamp: new Date().toISOString() });
}

export const GET = handle;
export const POST = handle;
