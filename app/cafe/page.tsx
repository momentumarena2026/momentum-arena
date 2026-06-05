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
  // surfaced (matches the customer-facing rule); out-of-stock
  // items still appear so customers see what the cafe serves,
  // but the add-to-cart → order-create path stock-checks at
  // order time and refuses lines that would push quantity below
  // zero.
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
      image: item.image,
      isVeg: item.isVeg,
      isAvailable: item.isAvailable,
      tags: item.tags,
    });
  }

  return <CafeMenuPage groupedItems={groupedItems} />;
}
