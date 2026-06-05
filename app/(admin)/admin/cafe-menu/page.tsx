import { getCafeItems } from "@/actions/admin-cafe";
import { getCafeSettings } from "@/actions/cafe-settings";
import { CafeMenuClient } from "./cafe-menu-client";
import { CafeOpenToggle } from "./cafe-open-toggle";

export default async function AdminCafeMenuPage() {
  // Single round-trip for both pieces of state — items list + the
  // open/closed switch the header pill flips. CafeSettings is a
  // single row so the lookup is effectively constant time.
  const [{ items }, settings] = await Promise.all([
    getCafeItems({ showUnavailable: true }),
    getCafeSettings(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Cafe Menu Management</h1>
          <p className="mt-1 text-zinc-400">
            Manage your cafe menu items, prices, and availability
          </p>
        </div>
        {/* Header pill — flips CafeSettings.isOpen on click.
            Drives the customer-facing /cafe page + the mobile
            Cafe tab. Admin walk-in ordering is unaffected. */}
        <CafeOpenToggle initialOpen={settings.isOpen} />
      </div>

      <CafeMenuClient
        items={items.map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          category: item.category,
          price: item.price,
          costPrice: item.costPrice,
          quantity: item.quantity,
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
