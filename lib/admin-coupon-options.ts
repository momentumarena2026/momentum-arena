/**
 * Coupons an admin may apply while creating a booking.
 *
 * Lives here rather than in the server action because the mobile admin
 * needs the same list under a Bearer token, and the action's cookie-based
 * requireAdmin() doesn't answer that. Both callers share this query so a
 * coupon that shows on the web create form also shows in the app.
 *
 * This is only a prefilter (live window + sport/category + usage cap) —
 * adminCreateBooking still re-runs the full customer-side validator on
 * whichever code is picked, so per-user rules (FIRST_TIME, once-per-user)
 * are enforced at create time, not here.
 */

import { db } from "@/lib/db";

export interface AdminCouponOption {
  code: string;
  description: string | null;
  type: string;
  value: number;
  maxDiscount: number | null;
  autoApply: boolean;
  /** Set when the coupon only applies to certain customers — the picker
   *  shows it, but warns that the server may reject it. */
  restrictedNote: string | null;
}

export async function listAdminBookingCoupons(
  sport: string,
  category?: string | null,
): Promise<AdminCouponOption[]> {
  const now = new Date();
  const rows = await db.coupon.findMany({
    where: {
      isActive: true,
      scope: { in: ["SPORTS", "BOTH"] },
      validFrom: { lte: now },
      validUntil: { gte: now },
    },
    orderBy: [{ autoApply: "desc" }, { createdAt: "desc" }],
    select: {
      code: true,
      description: true,
      type: true,
      value: true,
      maxDiscount: true,
      autoApply: true,
      sportFilter: true,
      categoryExclude: true,
      maxUses: true,
      usedCount: true,
      userGroupFilter: true,
      maxUsesPerUser: true,
      _count: { select: { eligibleUsers: true, eligibleGroups: true } },
    },
  });

  return rows
    .filter((c) => {
      // Empty sportFilter = every sport.
      if (c.sportFilter.length > 0 && !c.sportFilter.includes(sport as never)) {
        return false;
      }
      if (category && c.categoryExclude.includes(category as never)) return false;
      if (c.maxUses !== null && c.usedCount >= c.maxUses) return false;
      return true;
    })
    .map((c) => ({
      code: c.code,
      description: c.description,
      type: c.type,
      value: c.value,
      maxDiscount: c.maxDiscount,
      autoApply: c.autoApply,
      restrictedNote: restrictionNote(c),
    }));
}

/** A short "this may not apply to this customer" hint, so the admin isn't
 *  surprised when the server rejects an otherwise-live code. */
function restrictionNote(c: {
  userGroupFilter: string[];
  maxUsesPerUser: number | null;
  _count: { eligibleUsers: number; eligibleGroups: number };
}): string | null {
  const bits: string[] = [];
  if (c.userGroupFilter.length > 0) {
    bits.push(c.userGroupFilter.map(prettyGroup).join(" / ") + " only");
  }
  if (c._count.eligibleUsers > 0 || c._count.eligibleGroups > 0) {
    bits.push("selected customers only");
  }
  if (c.maxUsesPerUser !== null) {
    bits.push(
      c.maxUsesPerUser === 1
        ? "once per customer"
        : `${c.maxUsesPerUser}× per customer`,
    );
  }
  return bits.length > 0 ? bits.join(" · ") : null;
}

function prettyGroup(g: string): string {
  return g
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
