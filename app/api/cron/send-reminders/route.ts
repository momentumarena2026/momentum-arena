import { NextResponse } from "next/server";
import { sendBookingReminders } from "@/lib/reminders";

/**
 * Cron worker — booking reminders at 24 hours, 2 hours and 1 hour.
 *
 * Runs HOURLY, and the hour is load-bearing rather than a preference: the
 * 2h stage only looks at bookings starting at `currentHour + 2`, and the 1h
 * stage at `currentHour + 1`. A missed hour is not a delayed reminder, it is
 * a reminder that never goes out, because the next pass is looking at a
 * different slot.
 *
 * That is why this moved off GitHub Actions, which was delivering 6 runs a
 * day against an hourly schedule — most hours' 2h and 1h reminders were
 * simply never sent. The schedule lives in `vercel.json` now, which honours
 * it, and the workflow is gone rather than left looking like coverage.
 */

// Three stages over a day's bookings, each doing an SMS and a push per
// booking. The platform default of 60s is not enough on a busy day.
export const maxDuration = 300;

// Vercel cron fires via GET; both are accepted so a manual POST curl still
// works during operations.
async function handle(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  // Refuses on a missing secret rather than running open — this endpoint
  // sends SMS to customers, which costs money per message.
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await sendBookingReminders();

  return NextResponse.json({
    ...results,
    timestamp: new Date().toISOString(),
  });
}

export const GET = handle;
export const POST = handle;
