import { db } from "@/lib/db";
import { getCafeSettings } from "@/actions/cafe-settings";
import { CafeMenuPage } from "@/components/cafe/cafe-menu-page";
import { CafeClosedPage } from "@/components/cafe/cafe-closed-page";

// Cafe items + settings change at admin-edit time; render on
// every request rather than holding a stale ISR snapshot. The
// settings lookup is a single row and the items list is bounded
// — cheap to hit per request.
export const dynamic = "force-dynamic";

interface MenuItem {
  id: string;
  name: string;
  description: string | null;
  category: string;
  price: number;
  // Stock counter. NULL = unlimited / kitchen-prepared; an integer is
  // the on-hand count. Surfaced so the menu can mark quantity===0 items
  // "Out of stock" (disable Add) and cap the stepper at what's left,
  // instead of only rejecting at order time.
  quantity: number | null;
  image: string | null;
  isVeg: boolean;
  isAvailable: boolean;
  tags: string[];
}

export default async function CafePage() {
  const settings = await getCafeSettings();

  // Closed → render the warm "we're taking a breather" page. Skip
  // the items query entirely; no point fetching what we won't
  // render. Admin walk-in ordering on /admin/cafe-orders/create
  // stays operational regardless.
  if (!settings.isOpen) {
    return <CafeClosedPage />;
  }

  // Open → fetch the menu and hand it to the existing customer
  // CafeMenuPage component. Only `isAvailable: true` items are
  // surfaced (matches the customer-facing rule). Out-of-stock items
  // (quantity===0) still appear so customers see the full menu, but
  // CafeMenuPage marks them "Out of stock" and disables Add — with
  // the order-create path stock-checking at order time as a backstop.
  const items = await db.cafeItem.findMany({
    where: { isAvailable: true },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
  });

  const groupedItems: Record<string, MenuItem[]> = {};
  for (const item of items) {
    if (!groupedItems[item.category]) groupedItems[item.category] = [];
    groupedItems[item.category].push({
      id: item.id,
      name: item.name,
      description: item.description,
      category: item.category,
      price: item.price,
      quantity: item.quantity,
      image: item.image,
      isVeg: item.isVeg,
      isAvailable: item.isAvailable,
      tags: item.tags,
    });
  }

  return <CafeMenuPage groupedItems={groupedItems} />;
}
