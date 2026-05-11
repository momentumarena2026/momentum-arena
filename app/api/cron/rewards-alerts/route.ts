import { NextResponse } from "next/server";
import { runAlertSweep } from "@/lib/rewards/alerts";

/**
 * Hourly alert generator for rewards. Scans for anomalies that
 * aren't caught at txn time (inline alerts cover BULK_REDEMPTION,
 * PARTIAL_REVOKE_SHORTFALL, ADJUSTMENT_AUDIT — see
 * lib/rewards/{redeem,revoke,earn}.ts).
 *
 * Checks:
 *   - HIGH_VELOCITY_EARN
 *   - RAPID_EARN_REDEEM (safety net)
 *   - DUPLICATE_PHONE_USERS
 *   - REFUND_THEN_RETAIN
 *   - NEGATIVE_BALANCE
 *
 * 24h dedupe per (user, kind) so noise stays manageable.
 */
async function handle(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runAlertSweep();
  return NextResponse.json({ ...result, timestamp: new Date().toISOString() });
}

export const GET = handle;
export const POST = handle;
