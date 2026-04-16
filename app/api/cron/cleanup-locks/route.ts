import { NextResponse } from "next/server";
import { cleanupExpiredHolds } from "@/lib/slot-hold";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cleaned = await cleanupExpiredHolds();
  return NextResponse.json({ cleaned, timestamp: new Date().toISOString() });
}
