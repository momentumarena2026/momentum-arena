import { request } from "./admin-api";

export interface AdminProductCategory {
  id: string;
  name: string;
  displayOrder?: number;
  isActive?: boolean;
  _count?: { products: number };
}

export interface CreateCategoryInput {
  name: string;
  displayOrder?: number;
}

export interface UpdateCategoryInput {
  name?: string;
  displayOrder?: number;
  isActive?: boolean;
}

export interface AdjustStockInput {
  /** Signed delta — positive adds, negative removes. */
  stockDelta: number;
  /** Required audit note recorded on the ProductStockMovement. */
  stockNote: string;
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
  /** Audited stock adjustment with a required note (mirrors web's stock dialog). */
  adjustStock: (id: string, body: AdjustStockInput) =>
    request<{ ok: true }>(`/api/mobile/admin/products/${id}`, {
      method: "PATCH",
      body,
    }),
};

export const adminProductCategoriesApi = {
  list: () =>
    request<{ categories: AdminProductCategory[] }>(
      "/api/mobile/admin/products/categories",
      { method: "GET" },
    ),
  create: (body: CreateCategoryInput) =>
    request<{ ok: true }>("/api/mobile/admin/products/categories", {
      method: "POST",
      body,
    }),
  update: (id: string, body: UpdateCategoryInput) =>
    request<{ ok: true }>(`/api/mobile/admin/products/categories/${id}`, {
      method: "PATCH",
      body,
    }),
  remove: (id: string) =>
    request<{ ok: true }>(`/api/mobile/admin/products/categories/${id}`, {
      method: "DELETE",
    }),
};
