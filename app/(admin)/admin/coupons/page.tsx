import Link from "next/link";
import { Users } from "lucide-react";
import { getCoupons } from "@/actions/admin-coupons";
import { listUserGroups } from "@/actions/admin-user-groups";
import { CouponsManager } from "./coupons-manager";

/**
 * /admin/coupons — coupons only.
 *
 * The User-Groups manager that used to live here as a tab has moved
 * to Settings → User Groups (/admin/users/groups). Groups themselves
 * still feed the coupon-targeting multi-select on the coupon form, so
 * we still fetch them — we just don't render the management UI here
 * anymore.
 */
export default async function AdminCouponsPage() {
  // Fetch coupons + group options in parallel. We need the groups for
  // the coupon-form multi-select even though the management UI lives
  // elsewhere now.
  const [coupons, groups] = await Promise.all([
    getCoupons(),
    listUserGroups(),
  ]);

  // Lightweight option list for the coupon-form multi-select. A
  // soft-deleted group never reaches this list (listUserGroups
  // filters on `deletedAt: null`), so the form never offers a
  // dead group as a target.
  const groupOptions = groups.map((g) => ({
    id: g.id,
    name: g.name,
    memberCount: g.memberCount,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Coupons</h1>
        <p className="mt-1 text-zinc-400">
          Create and manage promo codes — including the customer groups
          they target.
        </p>
      </div>

      {/* Cross-link to the new User Groups home so admins migrating
          from the old tabbed layout know where it went. */}
      <Link
        href="/admin/users/groups"
        className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 transition-colors hover:border-emerald-500/40"
      >
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-emerald-500/15 p-2 text-emerald-400">
            <Users className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-medium text-white">
              Manage user groups
            </p>
            <p className="text-xs text-zinc-500">
              Now under Settings → User Groups. Same cohorts feed coupon
              targeting + push notifications.
            </p>
          </div>
        </div>
        <span className="text-zinc-400 text-sm">→</span>
      </Link>

      <CouponsManager
        coupons={coupons.map((c) => ({
          id: c.id,
          code: c.code,
          description: c.description,
          scope: c.scope,
          type: c.type,
          value: c.value,
          maxDiscount: c.maxDiscount,
          maxUses: c.maxUses,
          usedCount: c.usedCount,
          maxUsesPerUser: c.maxUsesPerUser,
          minAmount: c.minAmount,
          sportFilter: c.sportFilter,
          categoryFilter: c.categoryFilter,
          categoryExclude: c.categoryExclude,
          userGroupFilter: c.userGroupFilter,
          isStackable: c.isStackable,
          stackGroup: c.stackGroup,
          isPublic: c.isPublic,
          isSystemCode: c.isSystemCode,
          autoApply: c.autoApply,
          showStrikethrough: c.showStrikethrough,
          validPlatforms: c.validPlatforms as ("web" | "android" | "ios")[],
          validFrom: c.validFrom.toISOString().split("T")[0],
          validUntil: c.validUntil.toISOString().split("T")[0],
          isActive: c.isActive,
          usageCount: c._count.usages,
          conditions: c.conditions.map((cond) => ({
            conditionType: cond.conditionType,
            conditionValue: cond.conditionValue,
          })),
          eligibleUsers: c.eligibleUsers.map((eu) => ({
            id: eu.user.id,
            name: eu.user.name,
            email: eu.user.email,
            phone: eu.user.phone,
          })),
          // Drop any soft-deleted groups defensively — they shouldn't
          // normally be referenced from an active coupon, but if they
          // are, hiding them here means the form just shows the live
          // ones and the admin can re-save to clean the stale link.
          eligibleGroups: c.eligibleGroups
            .filter((eg) => !eg.group.deletedAt)
            .map((eg) => ({
              id: eg.group.id,
              name: eg.group.name,
            })),
        }))}
        groupOptions={groupOptions}
      />
    </div>
  );
}
