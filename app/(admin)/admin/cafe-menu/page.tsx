import { getCafeItems } from "@/actions/admin-cafe";
import { getCafeSettings } from "@/actions/cafe-settings";
import { CafeMenuClient } from "./cafe-menu-client";
import { CafeOpenToggle } from "./cafe-open-toggle";

// Cafe items + settings change at admin-edit time; render on every
// request rather than risk a stale ISR snapshot from build-time.
export const dynamic = "force-dynamic";

export default async function AdminCafeMenuPage() {
  // Resolve the two pieces of page data in parallel. Both are
  // wrapped in `Promise.allSettled` instead of `Promise.all` so a
  // single transient failure (e.g. a Prisma timeout mid-migration)
  // doesn't take the whole route down — we surface a sensible
  // default and let the operator retry.
  const [itemsRes, settingsRes] = await Promise.allSettled([
    getCafeItems({ showUnavailable: true }),
    getCafeSettings(),
  ]);

  const itemsList =
    itemsRes.status === "fulfilled" && Array.isArray(itemsRes.value?.items)
      ? itemsRes.value.items
      : [];
  const isOpen =
    settingsRes.status === "fulfilled"
      ? Boolean(settingsRes.value?.isOpen ?? true)
      : true;

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
        <CafeOpenToggle initialOpen={isOpen} />
      </div>

      <CafeMenuClient
        items={itemsList.map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          category: item.category,
          price: item.price,
          // costPrice + quantity are nullable Prisma columns that
          // were added in later migrations — guard against `undefined`
          // (vs the expected `null`) for older client builds and
          // for the test/fallback paths where the field may be
          // missing entirely.
          costPrice: item.costPrice ?? null,
          quantity: item.quantity ?? null,
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
