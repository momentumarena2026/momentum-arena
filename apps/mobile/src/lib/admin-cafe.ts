import { request } from "./admin-api";

/**
 * API client for the mobile-admin cafe surface. Two halves:
 *   - Menu (items): list + per-item availability toggle.
 *   - Orders (kanban): live grouped lanes + status transitions + cancel.
 *
 * Order create/edit are intentionally not ported to mobile yet — the
 * customer app already creates orders, and the floor staff workflow
 * is "advance status / cancel", which is what this surface covers.
 */

export type CafeItemCategory =
  | "SNACKS"
  | "BEVERAGES"
  | "MEALS"
  | "DESSERTS"
  | "COMBOS";

export type CafeOrderStatus =
  | "PENDING"
  | "PREPARING"
  | "READY"
  | "COMPLETED"
  | "CANCELLED";

export interface CafeItem {
  id: string;
  name: string;
  description: string | null;
  category: CafeItemCategory;
  price: number;
  image: string | null;
  isVeg: boolean;
  isAvailable: boolean;
  tags: string[];
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CafeOrderLine {
  id: string;
  quantity: number;
  itemName: string;
  unitPrice: number;
  isVeg: boolean | null;
}

export interface CafeOrderListItem {
  id: string;
  orderNumber: string;
  status: CafeOrderStatus;
  totalAmount: number;
  createdAt: string;
  note: string | null;
  guestName: string | null;
  guestPhone: string | null;
  user: {
    id: string;
    name: string | null;
    phone: string | null;
  } | null;
  items: CafeOrderLine[];
  payment: {
    status: string;
    method: string;
  } | null;
}

export interface LiveCafeOrders {
  PENDING: CafeOrderListItem[];
  PREPARING: CafeOrderListItem[];
  READY: CafeOrderListItem[];
}

export interface CafeOrderStats {
  todayOrders: number;
  todayRevenue: number;
  pendingCount: number;
  popularItems: { name: string; quantity: number }[];
}

export const adminCafeApi = {
  items(filters?: {
    category?: CafeItemCategory;
    search?: string;
    showUnavailable?: boolean;
  }): Promise<{
    items: CafeItem[];
    grouped: Record<string, CafeItem[]>;
  }> {
    const params = new URLSearchParams();
    if (filters?.category) params.set("category", filters.category);
    if (filters?.search) params.set("search", filters.search);
    if (filters?.showUnavailable === false) params.set("showUnavailable", "0");
    const qs = params.toString();
    return request(
      `/api/mobile/admin/cafe/items${qs ? `?${qs}` : ""}`,
      { method: "GET" },
    );
  },

  toggleAvailability(
    id: string,
  ): Promise<{ ok: true; isAvailable: boolean }> {
    return request(`/api/mobile/admin/cafe/items/${id}/availability`, {
      method: "POST",
    });
  },

  liveOrders(): Promise<LiveCafeOrders> {
    return request("/api/mobile/admin/cafe/orders/live", { method: "GET" });
  },

  orderStats(): Promise<CafeOrderStats> {
    return request("/api/mobile/admin/cafe/orders/stats", { method: "GET" });
  },

  setOrderStatus(
    id: string,
    newStatus: CafeOrderStatus,
  ): Promise<{ ok: true }> {
    return request(`/api/mobile/admin/cafe/orders/${id}/status`, {
      method: "POST",
      body: { newStatus },
    });
  },

  cancelOrder(id: string, reason: string): Promise<{ ok: true }> {
    return request(`/api/mobile/admin/cafe/orders/${id}/cancel`, {
      method: "POST",
      body: { reason },
    });
  },
};
