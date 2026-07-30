"use server";

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import {
  arePassesEnabled,
  listUserPasses,
  getPassDetailForUser,
  addPassMemberForOwner,
  removePassMemberForOwner,
} from "@/lib/passes";
import { parseBands, bandKey, bandsSummary } from "@/lib/pass-bands";
import { passTimeChips } from "@/lib/pass-time-chips";
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
  // Peak/off-peak hour windows — resolved onto each plan's bands so the
  // cards can say "Weekdays 5am–5pm" instead of just "Off-peak".
  const classifications = await db.timeClassification.findMany({
    select: { startHour: true, endHour: true, dayType: true, timeType: true },
  });
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
      timeChips: passTimeChips(bands, classifications),
    }));
}

export async function getMyPasses() {
  const session = await auth();
  if (!session?.user?.id) return [];
  // Owned passes + passes shared with me (member) — shared shape with
  // the mobile /api/mobile/passes route.
  return listUserPasses(session.user.id);
}

// ─── Pass detail + shared members ───────────────────────────────────
// Core logic lives in lib/passes.ts (shared with the mobile API
// routes); these actions just supply the session viewer.

/**
 * Full pass detail for the customer detail page. Visible to the OWNER
 * and to shared MEMBERS; only the owner may edit members. Returns null
 * when the pass doesn't exist or the viewer has no relation to it.
 */
export async function getPassDetail(passId: string) {
  const session = await auth();
  if (!session?.user?.id) return null;
  return getPassDetailForUser(passId, session.user.id);
}

/**
 * Owner adds a member by registered phone number. If the number isn't
 * registered, returns notRegistered so the UI can offer a WhatsApp
 * invite instead. Cap = CourtConfig.maxPassMembers for the pass's court.
 */
export async function addPassMemberByPhone(passId: string, phoneRaw: string) {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false as const, error: "Sign in first." };
  }
  const result = await addPassMemberForOwner(passId, session.user.id, phoneRaw);
  if (result.ok) revalidatePath(`/passes/${passId}`);
  return result;
}

/** Owner removes a member. */
export async function removePassMember(passId: string, memberUserId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false as const, error: "Sign in first." };
  }
  const result = await removePassMemberForOwner(
    passId,
    session.user.id,
    memberUserId,
  );
  if (result.ok) revalidatePath(`/passes/${passId}`);
  return result;
}
