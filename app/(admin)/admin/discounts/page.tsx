import { getDiscountCodes } from "@/actions/admin-discounts";
import { formatPrice } from "@/lib/pricing";
import { DiscountManager } from "./discount-manager";

export default async function AdminDiscountsPage() {
  const { codes } = await getDiscountCodes({ showInactive: true });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Discount Codes</h1>
        <p className="mt-1 text-zinc-400">
          Create and manage promotional discount codes
        </p>
      </div>

      <DiscountManager
        codes={codes.map((c) => ({
          id: c.id,
          code: c.code,
          type: c.type,
          value: c.value,
          maxUses: c.maxUses,
          usedCount: c.usedCount,
          maxUsesPerUser: c.maxUsesPerUser,
          minBookingAmount: c.minBookingAmount,
          sportFilter: c.sportFilter,
          validFrom: c.validFrom.toISOString().split("T")[0],
          validUntil: c.validUntil.toISOString().split("T")[0],
          isSystemCode: c.isSystemCode,
          isActive: c.isActive,
          usageCount: c._count.usages,
        }))}
      />
    </div>
  );
}
