import { getCoupons } from "@/actions/admin-coupons";
import { CouponsManager } from "./coupons-manager";

export default async function AdminCouponsPage() {
  const coupons = await getCoupons();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Unified Coupons</h1>
        <p className="mt-1 text-zinc-400">
          Create and manage coupons for sports bookings, cafe orders, or both
        </p>
      </div>

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
        }))}
      />
    </div>
  );
}
