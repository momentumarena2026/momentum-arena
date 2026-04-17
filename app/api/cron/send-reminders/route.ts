import { NextResponse } from "next/server";
import { sendBookingReminders } from "@/lib/reminders";

// Vercel cron fires via GET; both are accepted so a manual POST curl still
// works during operations.
async function handle(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
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
