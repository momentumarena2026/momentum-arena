import { NextResponse } from "next/server";
import { cleanupExpiredLocks } from "@/lib/slot-lock";

export async function GET(request: Request) {
  // Verify cron secret for security
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cleaned = await cleanupExpiredLocks();
  return NextResponse.json({ cleaned, timestamp: new Date().toISOString() });
}
