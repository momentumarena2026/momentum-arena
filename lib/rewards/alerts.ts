import { db } from "@/lib/db";
import { getRewardConfig } from "./config";

/**
 * Hourly alert generator. Scans recent activity and writes
 * RewardAlert rows for anomalies that aren't caught at txn time
 * (those — BULK_REDEMPTION, PARTIAL_REVOKE_SHORTFALL,
 * ADJUSTMENT_AUDIT — are written inline by earn/redeem/revoke).
 *
 * Called from /api/cron/rewards-alerts.
 *
 * Dedupe strategy: each check writes at most ONE OPEN alert per
 * user per kind in any 24h window. Re-raising would be noise —
 * the admin sees the existing OPEN alert and dismisses or actions
 * it; we don't need to wake them up again.
 */

const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function runAlertSweep(): Promise<{ alertsCreated: number }> {
  const cfg = await getRewardConfig();
  const now = new Date();
  let created = 0;

  // 1. HIGH_VELOCITY_EARN: users who earned > threshold points in
  //    the last 24h.
  type VRow = { userId: string; points_in_24h: bigint };
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const velocity = await db.$queryRaw<VRow[]>`
    SELECT "userId", COALESCE(SUM("points"), 0)::bigint AS points_in_24h
    FROM "RewardTransaction"
    WHERE "createdAt" >= ${since24h}
      AND "points" > 0
    GROUP BY "userId"
    HAVING COALESCE(SUM("points"), 0) > ${cfg.highVelocityEarnDailyThreshold}
  `;
  for (const row of velocity) {
    if (await hasRecentAlert(row.userId, "HIGH_VELOCITY_EARN")) continue;
    await db.rewardAlert.create({
      data: {
        userId: row.userId,
        kind: "HIGH_VELOCITY_EARN",
        severity: "HIGH",
        status: "OPEN",
        details: {
          pointsIn24h: Number(row.points_in_24h),
          threshold: cfg.highVelocityEarnDailyThreshold,
        },
      },
    });
    created++;
  }

  // 2. RAPID_EARN_REDEEM: users who EARNED + REDEEMED within
  //    cfg.earnToRedeemMinHours of each other. Strong signal of
  //    abuse (book micro-slot to earn, redeem on big booking).
  //    The earn-to-redeem hold check in redeem.ts blocks this for
  //    new attempts; legacy data + edge cases get flagged here.
  type RRow = { userId: string };
  const holdHours = cfg.earnToRedeemMinHours;
  const rapidPairs = await db.$queryRaw<RRow[]>`
    SELECT DISTINCT r."userId"
    FROM "RewardTransaction" r
    JOIN "RewardTransaction" e
      ON e."userId" = r."userId"
     AND e."type" IN ('EARNED_BOOKING', 'EARNED_CAFE', 'EARNED_SIGNUP',
                      'EARNED_REFERRAL', 'EARNED_BIRTHDAY', 'EARNED_ADJUSTMENT',
                      'ADJUSTMENT_REFUND')
     AND e."createdAt" >= ${since24h}
     AND EXTRACT(EPOCH FROM (r."createdAt" - e."createdAt")) <= ${holdHours * 3600}
     AND r."createdAt" > e."createdAt"
    WHERE r."type" IN ('REDEEMED_BOOKING', 'REDEEMED_CAFE')
      AND r."createdAt" >= ${since24h}
  `;
  for (const row of rapidPairs) {
    if (await hasRecentAlert(row.userId, "RAPID_EARN_REDEEM")) continue;
    await db.rewardAlert.create({
      data: {
        userId: row.userId,
        kind: "RAPID_EARN_REDEEM",
        severity: "MEDIUM",
        status: "OPEN",
        details: {
          holdHoursConfig: holdHours,
          detectedAt: now.toISOString(),
        },
      },
    });
    created++;
  }

  // 3. DUPLICATE_PHONE_USERS: more than one User row sharing a
  //    normalized phone. Flag both; admin can investigate.
  type DupRow = { phone: string; user_ids: string };
  const duplicates = await db.$queryRaw<DupRow[]>`
    SELECT phone, STRING_AGG(id, ',') AS user_ids
    FROM "User"
    WHERE phone IS NOT NULL
    GROUP BY phone
    HAVING COUNT(*) > 1
  `;
  for (const row of duplicates) {
    const userIds = row.user_ids.split(",");
    for (const userId of userIds) {
      if (await hasRecentAlert(userId, "DUPLICATE_PHONE_USERS")) continue;
      await db.rewardAlert.create({
        data: {
          userId,
          kind: "DUPLICATE_PHONE_USERS",
          severity: "HIGH",
          status: "OPEN",
          details: {
            phone: row.phone,
            siblingUserIds: userIds.filter((id) => id !== userId),
          },
        },
      });
      created++;
    }
  }

  // 4. REFUND_THEN_RETAIN: booking.status=CANCELLED but
  //    EARNED_BOOKING still has no matching REVOKED row.
  //    revokeBookingRewards should catch this inline; this is a
  //    safety net for paths that didn't call it (e.g. direct
  //    DB cancel).
  type RTRRow = { userId: string; booking_id: string };
  const orphans = await db.$queryRaw<RTRRow[]>`
    SELECT t."userId", t."bookingId" AS booking_id
    FROM "RewardTransaction" t
    JOIN "Booking" b ON b.id = t."bookingId"
    LEFT JOIN "RewardTransaction" r
      ON r."bookingId" = t."bookingId" AND r.type = 'REVOKED'
    WHERE t.type = 'EARNED_BOOKING'
      AND b.status = 'CANCELLED'
      AND r.id IS NULL
  `;
  for (const row of orphans) {
    if (await hasRecentAlert(row.userId, "REFUND_THEN_RETAIN")) continue;
    await db.rewardAlert.create({
      data: {
        userId: row.userId,
        kind: "REFUND_THEN_RETAIN",
        severity: "HIGH",
        status: "OPEN",
        details: {
          bookingId: row.booking_id,
        },
      },
    });
    created++;
  }

  // 5. NEGATIVE_BALANCE: any user with pointsAvailable < 0 means a
  //    bug somewhere — page an admin.
  const negatives = await db.rewardBalance.findMany({
    where: { pointsAvailable: { lt: 0 } },
    select: { userId: true, pointsAvailable: true },
  });
  for (const n of negatives) {
    if (await hasRecentAlert(n.userId, "NEGATIVE_BALANCE")) continue;
    await db.rewardAlert.create({
      data: {
        userId: n.userId,
        kind: "NEGATIVE_BALANCE",
        severity: "HIGH",
        status: "OPEN",
        details: { balance: n.pointsAvailable },
      },
    });
    created++;
  }

  return { alertsCreated: created };
}

async function hasRecentAlert(
  userId: string,
  kind: "HIGH_VELOCITY_EARN" | "RAPID_EARN_REDEEM" | "DUPLICATE_PHONE_USERS" | "REFUND_THEN_RETAIN" | "NEGATIVE_BALANCE",
): Promise<boolean> {
  const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
  const existing = await db.rewardAlert.findFirst({
    where: { userId, kind, status: "OPEN", createdAt: { gte: since } },
    select: { id: true },
  });
  return existing !== null;
}
