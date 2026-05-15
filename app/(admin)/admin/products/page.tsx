import { listProductsForAdmin, listProductCategories } from "@/actions/admin-products";
import { ProductsManager } from "./products-manager";

export default async function AdminProductsPage() {
  const [products, categories] = await Promise.all([
    listProductsForAdmin({ showInactive: true }),
    listProductCategories(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Shop Catalog</h1>
        <p className="mt-1 text-zinc-400">
          Sellable items + stock + images. Stock adjustments are
          captured in the audit trail per product.
        </p>
      </div>

      <ProductsManager
        products={products.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          pricePaise: p.pricePaise,
          stockQuantity: p.stockQuantity,
          lowStockThreshold: p.lowStockThreshold,
          imageUrl: p.imageUrl,
          isActive: p.isActive,
          displayOrder: p.displayOrder,
          categoryId: p.categoryId,
          categoryName: p.category?.name ?? null,
          orderCount: p._count.orderItems,
        }))}
        categories={categories.map((c) => ({
          id: c.id,
          name: c.name,
          displayOrder: c.displayOrder,
        }))}
      />
    </div>
  );
}
