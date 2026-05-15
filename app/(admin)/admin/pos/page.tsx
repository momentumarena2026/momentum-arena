import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { PosClient } from "./pos-client";

export const dynamic = "force-dynamic";

export default async function AdminPosPage() {
  await requireAdmin("MANAGE_SHOP_ORDERS");

  const products = await db.product.findMany({
    where: { isActive: true, stockQuantity: { gt: 0 } },
    include: { category: true },
    orderBy: [
      { category: { displayOrder: "asc" } },
      { displayOrder: "asc" },
      { createdAt: "desc" },
    ],
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Walk-in Sale</h1>
        <p className="mt-1 text-zinc-400">
          Ring up an in-person sale. Add items to the bill, pick a
          customer (or create one), and choose how they paid.
        </p>
      </div>

      <PosClient
        products={products.map((p) => ({
          id: p.id,
          name: p.name,
          pricePaise: p.pricePaise,
          stockQuantity: p.stockQuantity,
          imageUrl: p.imageUrl,
          categoryName: p.category?.name ?? null,
        }))}
      />
    </div>
  );
}
