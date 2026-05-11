import { NextResponse } from "next/server";
import { runExpirySweep } from "@/lib/rewards/expire";

/**
 * Daily expiry cron. Sweeps RewardTransaction rows where
 * type IN (EARNED_*, ADJUSTMENT_REFUND) AND expiresAt < now AND no
 * corresponding EXPIRED row, writing one EXPIRED txn per expired
 * earn. Capped at the user's current pointsAvailable so a partly-
 * consumed earn can't drive balance negative.
 *
 * Idempotent — re-running on the same data is a no-op (every earn
 * already has its EXPIRED consumer).
 */
async function handle(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runExpirySweep();
  return NextResponse.json({ ...result, timestamp: new Date().toISOString() });
}

export const GET = handle;
export const POST = handle;
