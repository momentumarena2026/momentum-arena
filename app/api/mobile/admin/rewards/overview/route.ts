import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import { getRewardConfig, pointsToPaise } from "@/lib/rewards/config";

/**
 * Mobile admin rewards overview. Mirrors the web
 * /admin/rewards Overview panel — kept thin so the JSON stays the
 * single source of truth for both UIs.
 */
export async function GET(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (
    admin.role !== "SUPERADMIN" &&
    !hasPermission(admin.permissions ?? [], "MANAGE_REWARDS")
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const horizon = new Date();
  horizon.setUTCDate(horizon.getUTCDate() - 30);

  const [
    cfg,
    balanceAgg,
    balanceCount,
    earnAgg,
    redeemAgg,
    expireAgg,
    openAlerts,
  ] = await Promise.all([
    getRewardConfig(),
    db.rewardBalance.aggregate({ _sum: { pointsAvailable: true } }),
    db.rewardBalance.count({ where: { pointsAvailable: { gt: 0 } } }),
    db.rewardTransaction.aggregate({
      where: {
        type: {
          in: [
            "EARNED_BOOKING",
            "EARNED_CAFE",
            "EARNED_SIGNUP",
            "EARNED_REFERRAL",
            "EARNED_BIRTHDAY",
            "EARNED_ADJUSTMENT",
          ],
        },
        createdAt: { gte: horizon },
      },
      _sum: { points: true },
    }),
    db.rewardTransaction.aggregate({
      where: {
        type: { in: ["REDEEMED_BOOKING", "REDEEMED_CAFE"] },
        createdAt: { gte: horizon },
      },
      _sum: { points: true },
    }),
    db.rewardTransaction.aggregate({
      where: { type: "EXPIRED", createdAt: { gte: horizon } },
      _sum: { points: true },
    }),
    db.rewardAlert.count({ where: { status: "OPEN" } }),
  ]);

  const outstanding = balanceAgg._sum.pointsAvailable ?? 0;
  return NextResponse.json({
    overview: {
      totalUsersWithBalance: balanceCount,
      totalPointsOutstanding: outstanding,
      totalPaiseOutstanding: pointsToPaise(outstanding, cfg),
      pointsEarnedLast30d: earnAgg._sum.points ?? 0,
      pointsRedeemedLast30d: Math.abs(redeemAgg._sum.points ?? 0),
      pointsExpiredLast30d: Math.abs(expireAgg._sum.points ?? 0),
      openAlerts,
      enabled: cfg.enabled,
      earnRateBookingBps: cfg.earnRateBookingBps,
      earnRateCafeBps: cfg.earnRateCafeBps,
    },
  });
}
