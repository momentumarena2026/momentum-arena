import { getCafeItems } from "@/actions/admin-cafe";
import { CreateCafeOrderForm } from "./create-cafe-order-form";

export default async function CreateCafeOrderPage() {
  const { items } = await getCafeItems({ showUnavailable: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">New Cafe Order</h1>
        <p className="mt-1 text-zinc-400">
          Create a new order for walk-in or registered customers
        </p>
      </div>

      <CreateCafeOrderForm
        menuItems={items.map((item) => ({
          id: item.id,
          name: item.name,
          category: item.category,
          price: item.price,
          isVeg: item.isVeg,
          tags: item.tags,
        }))}
      />
    </div>
  );
}
