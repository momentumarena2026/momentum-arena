import { getCafeItems } from "@/actions/admin-cafe";
import { CafeMenuClient } from "./cafe-menu-client";

export default async function AdminCafeMenuPage() {
  const { items } = await getCafeItems({ showUnavailable: true });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Cafe Menu Management</h1>
        <p className="mt-1 text-zinc-400">
          Manage your cafe menu items, prices, and availability
        </p>
      </div>

      <CafeMenuClient
        items={items.map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          category: item.category,
          price: item.price,
          image: item.image,
          isVeg: item.isVeg,
          isAvailable: item.isAvailable,
          sortOrder: item.sortOrder,
          tags: item.tags,
        }))}
      />
    </div>
  );
}
