import { NextResponse } from "next/server";
import { expireOldReports } from "@/lib/reports/queue";

/**
 * Daily cron — expires Report rows older than 90 days. Bytes are
 * nulled out and status flips to EXPIRED; the row itself stays for
 * audit (admin can still see "Nakul requested April recon on May
 * 7" 6 months later). Re-requesting regenerates fresh bytes.
 *
 * Same Bearer CRON_SECRET pattern as the other crons.
 */
async function handle(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const expired = await expireOldReports(90);
  return NextResponse.json({
    expired,
    timestamp: new Date().toISOString(),
  });
}

export const GET = handle;
export const POST = handle;
