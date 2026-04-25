import { getCoupons } from "@/actions/admin-coupons";
import { listUserGroups } from "@/actions/admin-user-groups";
import { CouponsTabs } from "./coupons-tabs";

export default async function AdminCouponsPage() {
  // Fetch the coupon list and the active user groups in parallel —
  // the tabbed UI mounts both regardless of which tab is open so
  // switching tabs feels instant. Groups also feed the coupon-form
  // multi-select, so we'd have to load them anyway.
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
        <h1 className="text-2xl font-bold text-white">Unified Coupons</h1>
        <p className="mt-1 text-zinc-400">
          Create and manage coupons, plus the customer groups they target
        </p>
      </div>

      <CouponsTabs
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
          userGroupFilter: c.userGroupFilter,
          isStackable: c.isStackable,
          stackGroup: c.stackGroup,
          isPublic: c.isPublic,
          isSystemCode: c.isSystemCode,
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
        groups={groups}
        groupOptions={groupOptions}
      />
    </div>
  );
}
