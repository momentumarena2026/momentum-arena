import { NextResponse } from "next/server";
import { sendBookingReminders } from "@/lib/reminders";

export async function POST(request: Request) {
  // Verify cron secret for security
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
