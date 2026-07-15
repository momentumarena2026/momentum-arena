"use server";

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { arePassesEnabled, passLiveStatus } from "@/lib/passes";
import { parseBands, bandKey, bandsSummary } from "@/lib/pass-bands";
import { courtGroupLabel } from "@/lib/court-config";

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
    include: {
      courtConfig: {
        select: {
          label: true,
          size: true,
          category: true,
          prices: {
            select: { dayType: true, timeType: true, pricePerSlot: true },
          },
        },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { price: "asc" }],
  });
  return plans
    .map((p) => {
      const bands = parseBands(p.bands);
      // Hide plans whose bands no longer price at the anchor (a sport
      // price change drifted them). Legacy unrestricted plans (no bands)
      // stay visible.
      const priceByBand = new Map(
        p.courtConfig.prices.map((r) => [
          `${r.dayType}-${r.timeType}`,
          r.pricePerSlot,
        ]),
      );
      const validBands =
        p.anchorPrice == null
          ? bands
          : bands.filter((b) => priceByBand.get(bandKey(b)) === p.anchorPrice);
      const pricingValid = bands.length === 0 || validBands.length > 0;
      return { p, bands, pricingValid };
    })
    .filter((x) => x.pricingValid)
    .map(({ p, bands }) => ({
      id: p.id,
      name: p.name,
      sport: String(p.sport),
      courtLabel: courtGroupLabel({
        sport: String(p.sport),
        size: String(p.courtConfig.size),
        category: p.courtConfig.category ? String(p.courtConfig.category) : null,
        label: p.courtConfig.label,
      }),
      isBowling: p.courtConfig.category === "BOWLING_MACHINE",
      hours: p.totalMinutes / 60,
      baseAmount: p.baseAmount,
      price: p.price,
      discountPercent: p.discountPercent,
      anchorPricePerHour: p.anchorPricePerHour,
      effectiveHourly: Math.round(p.price / (p.totalMinutes / 60)),
      validityDays: p.validityDays,
      bandsSummary: bandsSummary(bands),
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
    bandsSummary: bandsSummary(parseBands(p.bands)),
    purchasedAt: p.purchasedAt.toISOString(),
    startsAt: p.startsAt.toISOString(),
    expiresAt: p.expiresAt.toISOString(),
    status: passLiveStatus(p),
    redemptions: p.redemptions.map((r) => ({
      minutes: r.minutes,
      createdAt: r.createdAt.toISOString(),
      restored: !!r.restoredAt,
    })),
  }));
}
