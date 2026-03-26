import { db } from "@/lib/db";
import { CafeMenuPage } from "@/components/cafe/cafe-menu-page";

export default async function CafePage() {
  const items = await db.cafeItem.findMany({
    where: { isAvailable: true },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });

  // Also fetch unavailable items to show as "Currently Unavailable"
  const unavailableItems = await db.cafeItem.findMany({
    where: { isAvailable: false },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });

  const allItems = [...items, ...unavailableItems];

  // Group by category
  const grouped: Record<
    string,
    {
      id: string;
      name: string;
      description: string | null;
      category: string;
      price: number;
      image: string | null;
      isVeg: boolean;
      isAvailable: boolean;
      tags: string[];
    }[]
  > = {};

  for (const item of allItems) {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push({
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

  return <CafeMenuPage groupedItems={grouped} />;
}
