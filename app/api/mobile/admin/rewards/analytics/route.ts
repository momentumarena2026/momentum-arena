import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";

/**
 * Mobile admin rewards analytics. Mirrors the web rewards Analytics panel
 * (`getAdminRewardsAnalytics` in actions/admin-rewards.ts) — same 30-day
 * horizon, same earn/redeem type sets, same JS bucketing and top-10
 * earners groupBy. Kept as a thin DB mirror (like the overview route)
 * rather than calling the server action so auth stays route-local.
 */

const EARN_TYPES = [
  "EARNED_BOOKING",
  "EARNED_BOOKING_REMAINDER",
  "EARNED_CAFE",
  "EARNED_SIGNUP",
  "EARNED_REFERRAL",
  "EARNED_BIRTHDAY",
  "EARNED_ADJUSTMENT",
] as const;

const REDEEM_TYPES = ["REDEEMED_BOOKING", "REDEEMED_CAFE"] as const;

function bucket(rows: { createdAt: Date; points: number }[]) {
  const map = new Map<string, number>();
  for (const r of rows) {
    const k = r.createdAt.toISOString().split("T")[0];
    map.set(k, (map.get(k) ?? 0) + Math.abs(r.points));
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, points]) => ({ date, points }));
}

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

  const [earns, redeems, topEarnersRaw] = await Promise.all([
    db.rewardTransaction.findMany({
      where: { createdAt: { gte: horizon }, type: { in: [...EARN_TYPES] } },
      select: { createdAt: true, points: true },
    }),
    db.rewardTransaction.findMany({
      where: { createdAt: { gte: horizon }, type: { in: [...REDEEM_TYPES] } },
      select: { createdAt: true, points: true },
    }),
    db.rewardTransaction.groupBy({
      by: ["userId"],
      where: { createdAt: { gte: horizon }, type: { in: [...EARN_TYPES] } },
      _sum: { points: true },
      orderBy: { _sum: { points: "desc" } },
      take: 10,
    }),
  ]);

  const topEarnerIds = topEarnersRaw.map((g) => g.userId);
  const topUsers =
    topEarnerIds.length > 0
      ? await db.user.findMany({
          where: { id: { in: topEarnerIds } },
          select: { id: true, name: true },
        })
      : [];
  const nameMap = new Map(topUsers.map((u) => [u.id, u.name]));

  return NextResponse.json({
    analytics: {
      dailyEarnLast30d: bucket(earns),
      dailyRedeemLast30d: bucket(redeems),
      topEarners30d: topEarnersRaw.map((g) => ({
        userId: g.userId,
        name: nameMap.get(g.userId) ?? null,
        points: g._sum.points ?? 0,
      })),
    },
  });
}
