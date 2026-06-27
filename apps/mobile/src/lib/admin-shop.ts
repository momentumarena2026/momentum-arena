import { request } from "./admin-api";

/**
 * API client for the mobile-admin Shop (product orders) surface.
 * Mirrors the web /admin/product-orders list + detail. The orders
 * dashboard confirms payment for UPI / cash orders, marks them
 * fulfilled on pickup, and cancels (with stock release / refund).
 *
 * IMPORTANT: the shop domain stores money in PAISE. Every *Paise field
 * here is paise — divide by 100 before passing to formatRupees().
 */

export type ShopOrderStatus =
  | "PENDING"
  | "CONFIRMED"
  | "FULFILLED"
  | "CANCELLED"
  | "REFUNDED";

export interface ShopOrderListItem {
  id: string;
  orderNumber: string | null;
  status: ShopOrderStatus;
  totalPaise: number;
  createdAt: string;
  isPos: boolean;
  itemCount: number;
  customer: { name: string | null; phone: string | null };
  payment: { method: string; status: string } | null;
}

export interface ShopOrdersResponse {
  orders: ShopOrderListItem[];
  total: number;
  page: number;
  totalPages: number;
  summary: {
    orderCount: number;
    revenuePaise: number;
    costPaise: number;
    profitPaise: number;
    marginPct: number;
  };
}

export interface ShopOrderDetail {
  id: string;
  orderNumber: string | null;
  status: ShopOrderStatus;
  totalPaise: number;
  createdAt: string;
  isPos: boolean;
  cancelReason: string | null;
  customer: { name: string | null; phone: string | null; email: string | null };
  items: Array<{
    id: string;
    name: string;
    priceEachPaise: number;
    quantity: number;
    imageUrl: string | null;
  }>;
  payment: {
    method: string;
    status: string;
    utrNumber: string | null;
    razorpayPaymentId: string | null;
  } | null;
}

export const adminShopApi = {
  orders(filters?: {
    status?: ShopOrderStatus;
    search?: string;
    page?: number;
  }): Promise<ShopOrdersResponse> {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.search) params.set("q", filters.search);
    if (filters?.page) params.set("page", String(filters.page));
    const qs = params.toString();
    return request(
      `/api/mobile/admin/product-orders${qs ? `?${qs}` : ""}`,
      { method: "GET" },
    );
  },

  order(id: string): Promise<ShopOrderDetail> {
    return request(`/api/mobile/admin/product-orders/${id}`, { method: "GET" });
  },

  confirmPayment(id: string, utrNumber?: string): Promise<{ ok: true }> {
    return request(`/api/mobile/admin/product-orders/${id}`, {
      method: "POST",
      body: { action: "confirm", utrNumber },
    });
  },

  markFulfilled(id: string): Promise<{ ok: true }> {
    return request(`/api/mobile/admin/product-orders/${id}`, {
      method: "POST",
      body: { action: "fulfill" },
    });
  },

  cancel(id: string, reason: string): Promise<{ ok: true }> {
    return request(`/api/mobile/admin/product-orders/${id}`, {
      method: "POST",
      body: { action: "cancel", reason },
    });
  },
};
