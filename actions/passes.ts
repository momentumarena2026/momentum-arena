"use server";

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { arePassesEnabled, passLiveStatus } from "@/lib/passes";

/**
 * Customer-facing pass reads. Purchase runs through
 * /api/passes/create-order + verify (money-first); redemption lives
 * in the checkout flow.
 */

export async function getActivePassPlans() {
  // Storefront switch — OFF hides every plan from customers while
  // sold passes keep redeeming at checkout.
  if (!(await arePassesEnabled())) return [];
  const plans = await db.passPlan.findMany({
    where: { isActive: true },
    include: { courtConfig: { select: { label: true, category: true } } },
    orderBy: [{ sortOrder: "asc" }, { price: "asc" }],
  });
  return plans.map((p) => ({
    id: p.id,
    name: p.name,
    sport: String(p.sport),
    courtLabel: p.courtConfig.label,
    isBowling: p.courtConfig.category === "BOWLING_MACHINE",
    hours: p.totalMinutes / 60,
    baseAmount: p.baseAmount,
    price: p.price,
    discountPercent: p.discountPercent,
    anchorPricePerHour: p.anchorPricePerHour,
    effectiveHourly: Math.round(p.price / (p.totalMinutes / 60)),
    validityDays: p.validityDays,
  }));
}

export async function getMyPasses() {
  const session = await auth();
  if (!session?.user?.id) return [];
  const passes = await db.userPass.findMany({
    where: { userId: session.user.id },
    orderBy: { purchasedAt: "desc" },
    include: {
      redemptions: {
        orderBy: { createdAt: "desc" },
        select: { minutes: true, createdAt: true, restoredAt: true, bookingId: true },
      },
    },
  });
  return passes.map((p) => ({
    id: p.id,
    name: p.name,
    sport: String(p.sport),
    totalMinutes: p.totalMinutes,
    remainingMinutes: p.remainingMinutes,
    purchasedAt: p.purchasedAt.toISOString(),
    expiresAt: p.expiresAt.toISOString(),
    status: passLiveStatus(p),
    redemptions: p.redemptions.map((r) => ({
      minutes: r.minutes,
      createdAt: r.createdAt.toISOString(),
      restored: !!r.restoredAt,
    })),
  }));
}
