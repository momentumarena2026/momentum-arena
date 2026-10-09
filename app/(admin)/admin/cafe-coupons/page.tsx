import { getCafeCoupons } from "@/actions/admin-cafe-discounts";
import { formatPrice } from "@/lib/pricing";
import { CafeCouponsClient } from "./cafe-coupons-client";
import { istDateKey } from "@/lib/ist";

export default async function AdminCafeCouponsPage() {
  const { coupons } = await getCafeCoupons({ showInactive: true });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Cafe Coupons</h1>
        <p className="mt-1 text-zinc-400">
          Create and manage cafe discount coupons
        </p>
      </div>

      <CafeCouponsClient
        coupons={coupons.map((c) => ({
          id: c.id,
          code: c.code,
          type: c.type,
          value: c.value,
          maxUses: c.maxUses,
          usedCount: c.usedCount,
          maxUsesPerUser: c.maxUsesPerUser,
          minOrderAmount: c.minOrderAmount,
          categoryFilter: c.categoryFilter,
          validPlatforms: c.validPlatforms as ("web" | "android" | "ios")[],
          validFrom: istDateKey(c.validFrom),
          validUntil: istDateKey(c.validUntil),
          isActive: c.isActive,
          usageCount: c._count.usages,
        }))}
      />
    </div>
  );
}
