import { request } from "./admin-api";

export interface AdminProductCategory {
  id: string;
  name: string;
}

export interface AdminProduct {
  id: string;
  name: string;
  description: string | null;
  pricePaise: number;
  costPaise: number;
  stockQuantity: number;
  lowStockThreshold: number;
  imageUrl: string | null;
  isActive: boolean;
  categoryId: string | null;
  category: { id: string; name: string } | null;
  _count: { orderItems: number };
}

export interface CreateProductInput {
  name: string;
  description?: string | null;
  pricePaise: number;
  costPaise?: number;
  stockQuantity: number;
  lowStockThreshold?: number;
  categoryId?: string | null;
}

export interface UpdateProductInput {
  name?: string;
  description?: string | null;
  pricePaise?: number;
  costPaise?: number;
  lowStockThreshold?: number;
  categoryId?: string | null;
  isActive?: boolean;
  /** Audited stock change (target − current) — routed via adjustProductStock. */
  stockDelta?: number;
}

export const adminProductsApi = {
  list: (showInactive = false) =>
    request<{ products: AdminProduct[]; categories: AdminProductCategory[] }>(
      `/api/mobile/admin/products${showInactive ? "?showInactive=1" : ""}`,
      { method: "GET" },
    ),
  create: (body: CreateProductInput) =>
    request<{ ok: true }>("/api/mobile/admin/products", {
      method: "POST",
      body,
    }),
  update: (id: string, body: UpdateProductInput) =>
    request<{ ok: true }>(`/api/mobile/admin/products/${id}`, {
      method: "PATCH",
      body,
    }),
  remove: (id: string) =>
    request<{ ok: true }>(`/api/mobile/admin/products/${id}`, {
      method: "DELETE",
    }),
};
