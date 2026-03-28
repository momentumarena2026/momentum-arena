import { getEquipmentList } from "@/actions/admin-equipment";
import { EquipmentManager } from "./equipment-manager";

export default async function AdminEquipmentPage() {
  const result = await getEquipmentList({ showInactive: true });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Equipment Management</h1>
        <p className="mt-1 text-zinc-400">
          Manage rental equipment available to customers
        </p>
      </div>

      <EquipmentManager
        equipment={result.equipment.map((e) => ({
          id: e.id,
          name: e.name,
          sport: e.sport,
          pricePerHour: e.pricePerHour,
          totalUnits: e.totalUnits,
          availableUnits: e.availableUnits,
          isActive: e.isActive,
          imageUrl: e.imageUrl,
          rentalCount: e._count.rentals,
        }))}
      />
    </div>
  );
}
